/**
 * Manual journals, period close and year-end (spec §14).
 */

import { db, type Tx } from "@/lib/db";
import { NORMAL_BALANCE, SYSTEM_ACCOUNTS, type AccountType } from "@/lib/enums";
import { addDays, fiscalYearRange, toUtcDay } from "@/lib/dates";
import { getSystemAccount, naturalBalance, postJournal } from "./ledger";

export interface ManualJournalInput {
  companyId: string;
  date: Date | string;
  memo: string;
  isAdjusting?: boolean;
  lines: {
    accountId: string;
    debitCents?: number;
    creditCents?: number;
    description?: string;
    customerId?: string | null;
    vendorId?: string | null;
    projectId?: string | null;
  }[];
  userId?: string | null;
  /** Accountants posting adjusting entries into a closed period (§13). */
  allowClosedPeriod?: boolean;
}

export async function postManualJournal(input: ManualJournalInput) {
  return db.$transaction((tx) =>
    postJournal(tx, {
      companyId: input.companyId,
      date: toUtcDay(input.date),
      memo: input.memo,
      sourceType: input.isAdjusting ? "ADJUSTMENT" : "MANUAL",
      isAdjusting: input.isAdjusting,
      createdById: input.userId,
      allowClosedPeriod: input.allowClosedPeriod,
      lines: input.lines,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Period close (§14)
// ─────────────────────────────────────────────────────────────────────────────

export interface CloseChecklistItem {
  key: string;
  label: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

/**
 * The pre-close checks a bookkeeper must clear. Nothing here blocks the close
 * by itself — it surfaces what a reviewer needs to look at, and the UI shows
 * FAIL items in red so a period is never closed blind.
 */
export async function closeChecklist(
  companyId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<CloseChecklistItem[]> {
  const items: CloseChecklistItem[] = [];

  const totals = await db.journalLine.aggregate({
    where: { companyId, date: { gte: periodStart, lte: periodEnd } },
    _sum: { debitCents: true, creditCents: true },
  });
  const gap = (totals._sum.debitCents ?? 0) - (totals._sum.creditCents ?? 0);
  items.push({
    key: "balanced",
    label: "Journal entries balance",
    status: gap === 0 ? "PASS" : "FAIL",
    detail: gap === 0 ? "Debits equal credits for the period." : `Out of balance by ${(gap / 100).toFixed(2)}.`,
  });

  const uncategorized = await db.bankTransaction.count({
    where: { companyId, date: { gte: periodStart, lte: periodEnd }, status: "UNMATCHED" },
  });
  items.push({
    key: "bank_queue",
    label: "Bank transactions categorised",
    status: uncategorized === 0 ? "PASS" : "FAIL",
    detail: uncategorized === 0 ? "Nothing left in the review queue." : `${uncategorized} transaction(s) still uncategorised.`,
  });

  const unreconciled = await db.bankAccount.findMany({
    where: { companyId, isActive: true },
    select: {
      id: true, name: true,
      reconciliations: {
        where: { status: "COMPLETED", statementEndDate: { gte: periodStart } },
        select: { id: true },
      },
    },
  });
  const missing = unreconciled.filter((b) => b.reconciliations.length === 0);
  items.push({
    key: "reconciled",
    label: "Bank accounts reconciled",
    status: missing.length === 0 ? "PASS" : "WARN",
    detail: missing.length === 0 ? "All accounts reconciled through the period." : `Not reconciled: ${missing.map((m) => m.name).join(", ")}.`,
  });

  const drafts = await db.invoice.count({
    where: { companyId, status: "DRAFT", issueDate: { gte: periodStart, lte: periodEnd } },
  });
  const draftBills = await db.bill.count({
    where: { companyId, status: { in: ["DRAFT", "AWAITING_APPROVAL"] }, issueDate: { gte: periodStart, lte: periodEnd } },
  });
  items.push({
    key: "drafts",
    label: "No unposted documents",
    status: drafts + draftBills === 0 ? "PASS" : "WARN",
    detail: drafts + draftBills === 0 ? "Every invoice and bill in the period is posted." : `${drafts} draft invoice(s), ${draftBills} unposted bill(s).`,
  });

  const taxCollected = await db.taxEntry.aggregate({
    where: { companyId, date: { gte: periodStart, lte: periodEnd }, direction: "SALE" },
    _sum: { taxCents: true },
  });
  const taxPaid = await db.taxEntry.aggregate({
    where: { companyId, date: { gte: periodStart, lte: periodEnd }, direction: "PURCHASE" },
    _sum: { recoverableCents: true },
  });
  const net = (taxCollected._sum.taxCents ?? 0) - (taxPaid._sum.recoverableCents ?? 0);
  items.push({
    key: "tax",
    label: "Sales tax reviewed",
    status: "WARN",
    detail: `Net tax for the period is ${(net / 100).toFixed(2)}. Review Tax Centre before filing.`,
  });

  return items;
}

export async function closePeriod(companyId: string, periodId: string, userId: string) {
  return db.$transaction(async (tx) => {
    const period = await tx.fiscalPeriod.findFirst({ where: { id: periodId, companyId } });
    if (!period) throw new Error("Fiscal period not found in this company.");
    if (period.status !== "OPEN") throw new Error(`${period.name} is already ${period.status.toLowerCase()}.`);

    await tx.auditLog.create({
      data: {
        companyId, userId, action: "CLOSE", entityType: "FiscalPeriod", entityId: periodId,
        summary: `Closed ${period.name}`,
      },
    });
    return tx.fiscalPeriod.update({
      where: { id: periodId },
      data: { status: "CLOSED", closedAt: new Date(), closedById: userId },
    });
  });
}

export async function reopenPeriod(companyId: string, periodId: string, userId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const period = await tx.fiscalPeriod.findFirst({ where: { id: periodId, companyId } });
    if (!period) throw new Error("Fiscal period not found in this company.");
    if (period.status === "LOCKED") throw new Error(`${period.name} is locked and cannot be reopened.`);
    if (period.status === "OPEN") throw new Error(`${period.name} is already open.`);

    await tx.auditLog.create({
      data: {
        companyId, userId, action: "REOPEN", entityType: "FiscalPeriod", entityId: periodId,
        summary: `Reopened ${period.name}`, metadata: JSON.stringify({ reason }),
      },
    });
    return tx.fiscalPeriod.update({
      where: { id: periodId },
      data: { status: "OPEN", reopenedAt: new Date(), notes: reason },
    });
  });
}

/**
 * Year-end close: sweep every revenue and expense balance into Retained
 * Earnings so the next year starts from zero on the income statement (§14).
 */
export async function closeFiscalYear(companyId: string, fiscalYear: number, userId: string) {
  return db.$transaction(async (tx) => {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const { start, end } = fiscalYearRange(fiscalYear, company.fiscalYearStartMonth);

    const existing = await tx.journalEntry.findFirst({
      where: { companyId, sourceType: "CLOSING", date: end },
    });
    if (existing) throw new Error(`Fiscal ${fiscalYear} has already been closed (${existing.entryNo}).`);

    const balances = await tx.journalLine.groupBy({
      by: ["accountId", "accountType"],
      where: { companyId, date: { gte: start, lte: end }, accountType: { in: ["REVENUE", "EXPENSE"] } },
      _sum: { debitCents: true, creditCents: true },
    });

    const retained = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.RETAINED_EARNINGS);
    const lines: ManualJournalInput["lines"] = [];
    let netIncome = 0;

    for (const row of balances) {
      const balance = naturalBalance(
        row.accountType as AccountType,
        row._sum.debitCents ?? 0,
        row._sum.creditCents ?? 0,
      );
      if (balance === 0) continue;
      netIncome += row.accountType === "REVENUE" ? balance : -balance;
      // Post the opposite of the natural balance to zero the account out.
      const isDebitNatural = NORMAL_BALANCE[row.accountType as AccountType] === "DEBIT";
      lines.push(
        isDebitNatural
          ? { accountId: row.accountId, creditCents: balance, description: `Close FY${fiscalYear}` }
          : { accountId: row.accountId, debitCents: balance, description: `Close FY${fiscalYear}` },
      );
    }

    if (lines.length === 0) throw new Error("There is nothing to close for this fiscal year.");
    lines.push(
      netIncome >= 0
        ? { accountId: retained.id, creditCents: netIncome, description: `FY${fiscalYear} net income` }
        : { accountId: retained.id, debitCents: -netIncome, description: `FY${fiscalYear} net loss` },
    );

    const entry = await postJournal(tx, {
      companyId,
      date: end,
      memo: `Year-end close — fiscal ${fiscalYear}`,
      sourceType: "CLOSING",
      createdById: userId,
      allowClosedPeriod: true,
      lines,
    });

    await tx.fiscalPeriod.updateMany({
      where: { companyId, fiscalYear },
      data: { status: "LOCKED", closedAt: new Date(), closedById: userId },
    });

    return { entry, netIncomeCents: netIncome, nextYearStart: addDays(end, 1) };
  });
}

/** Post migrated opening balances against Opening Balance Equity (§6). */
export async function postOpeningBalances(
  companyId: string,
  date: Date,
  balances: { accountId: string; debitCents?: number; creditCents?: number }[],
  userId?: string | null,
) {
  return db.$transaction(async (tx: Tx) => {
    const obe = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY);
    const debit = balances.reduce((s, b) => s + (b.debitCents ?? 0), 0);
    const credit = balances.reduce((s, b) => s + (b.creditCents ?? 0), 0);
    const diff = debit - credit;

    const lines = balances.map((b) => ({
      accountId: b.accountId,
      debitCents: b.debitCents,
      creditCents: b.creditCents,
      description: "Opening balance",
    }));
    if (diff !== 0) {
      lines.push(
        diff > 0
          ? { accountId: obe.id, creditCents: diff, debitCents: undefined, description: "Opening balance equity" }
          : { accountId: obe.id, debitCents: -diff, creditCents: undefined, description: "Opening balance equity" },
      );
    }

    return postJournal(tx, {
      companyId,
      date: toUtcDay(date),
      memo: "Opening balances",
      sourceType: "OPENING",
      createdById: userId,
      lines,
    });
  });
}
