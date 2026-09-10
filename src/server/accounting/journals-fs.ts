import "server-only";

/**
 * Manual journals, period close and year-end (§14) — Firestore implementation.
 * Mirrors src/server/accounting/journals.ts.
 *
 * `closeChecklist` is deferred to Phase 5 (reports) — it reads across bank
 * transactions, invoices, bills and tax entries, none of which have a Firestore
 * repository yet.
 */

import { NORMAL_BALANCE, SYSTEM_ACCOUNTS, type AccountType } from "@/lib/enums";
import { addDays, fiscalYearRange, toUtcDay } from "@/lib/dates";
import { recordAuditTx } from "@/server/db/audit-logs";
import { getCompanyOrThrow } from "@/server/db/companies";
import { balancesInRange } from "@/server/db/account-balances";
import { setFiscalYearStatus, updateFiscalPeriodTx } from "@/server/db/fiscal-periods";
import { findClosingEntryTx } from "@/server/db/journal-entries";
import { listTaxEntriesInRange } from "@/server/db/tax-entries";
import { bills } from "@/server/db/bills";
import { invoices } from "@/server/db/invoices";
import { runTransaction, sub, toTimestamp } from "@/server/db/firestore";
import { sumsInRange } from "@/server/reports/ledger-fs";
import { getSystemAccount, naturalBalance, postJournal, PostingError } from "./ledger-fs";

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
  allowClosedPeriod?: boolean;
}

export async function postManualJournal(input: ManualJournalInput) {
  return runTransaction((tx) =>
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

// ── Pre-close checklist (§14) ───────────────────────────────────────────────

export interface CloseChecklistItem {
  key: string;
  label: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

export async function closeChecklist(
  companyId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<CloseChecklistItem[]> {
  const items: CloseChecklistItem[] = [];

  const sums = await sumsInRange(companyId, periodStart, periodEnd);
  let debit = 0;
  let credit = 0;
  for (const s of sums.values()) {
    debit += s.debitCents;
    credit += s.creditCents;
  }
  const gap = debit - credit;
  items.push({
    key: "balanced",
    label: "Journal entries balance",
    status: gap === 0 ? "PASS" : "FAIL",
    detail: gap === 0 ? "Debits equal credits for the period." : `Out of balance by ${(gap / 100).toFixed(2)}.`,
  });

  const uncategorized = (
    await sub(companyId, "bankTransactions")
      .where("status", "==", "UNMATCHED")
      .where("date", ">=", toTimestamp(periodStart))
      .where("date", "<=", toTimestamp(periodEnd))
      .get()
  ).size;
  items.push({
    key: "bank_queue",
    label: "Bank transactions categorised",
    status: uncategorized === 0 ? "PASS" : "FAIL",
    detail:
      uncategorized === 0
        ? "Nothing left in the review queue."
        : `${uncategorized} transaction(s) still uncategorised.`,
  });

  const draftInvoices = (
    await invoices.list(companyId, { where: [["status", "==", "DRAFT"]] })
  ).filter((i) => i.issueDate >= periodStart && i.issueDate <= periodEnd).length;
  const draftBills = (
    await bills.list(companyId, { where: [["status", "in", ["DRAFT", "AWAITING_APPROVAL"]]] })
  ).filter((b) => b.issueDate >= periodStart && b.issueDate <= periodEnd).length;
  items.push({
    key: "drafts",
    label: "No unposted documents",
    status: draftInvoices + draftBills === 0 ? "PASS" : "WARN",
    detail:
      draftInvoices + draftBills === 0
        ? "Every invoice and bill in the period is posted."
        : `${draftInvoices} draft invoice(s), ${draftBills} unposted bill(s).`,
  });

  const entries = await listTaxEntriesInRange(companyId, periodStart, periodEnd);
  const collected = entries.filter((e) => e.direction === "SALE").reduce((s, e) => s + e.taxCents, 0);
  const paid = entries
    .filter((e) => e.direction === "PURCHASE")
    .reduce((s, e) => s + e.recoverableCents, 0);
  items.push({
    key: "tax",
    label: "Sales tax reviewed",
    status: "WARN",
    detail: `Net tax for the period is ${((collected - paid) / 100).toFixed(2)}. Review Tax Centre before filing.`,
  });

  return items;
}

// ── Period close (§14) ──────────────────────────────────────────────────────

export async function closePeriod(companyId: string, periodId: string, userId: string) {
  return runTransaction(async (tx) => {
    const ref = sub(companyId, "fiscalPeriods").doc(periodId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Fiscal period not found in this company.");
    const period = snap.data()!;
    if (period.status !== "OPEN") {
      throw new Error(`${period.name} is already ${String(period.status).toLowerCase()}.`);
    }
    recordAuditTx(tx, {
      companyId,
      userId,
      action: "CLOSE",
      entityType: "FiscalPeriod",
      entityId: periodId,
      summary: `Closed ${period.name}`,
    });
    updateFiscalPeriodTx(tx, companyId, periodId, {
      status: "CLOSED",
      closedAt: new Date(),
      closedById: userId,
    });
    return { id: periodId, name: period.name as string, status: "CLOSED" as const };
  });
}

export async function reopenPeriod(
  companyId: string,
  periodId: string,
  userId: string,
  reason: string,
) {
  return runTransaction(async (tx) => {
    const ref = sub(companyId, "fiscalPeriods").doc(periodId);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Fiscal period not found in this company.");
    const period = snap.data()!;
    if (period.status === "LOCKED") {
      throw new Error(`${period.name} is locked and cannot be reopened.`);
    }
    if (period.status === "OPEN") throw new Error(`${period.name} is already open.`);

    recordAuditTx(tx, {
      companyId,
      userId,
      action: "REOPEN",
      entityType: "FiscalPeriod",
      entityId: periodId,
      summary: `Reopened ${period.name}`,
      metadata: { reason },
    });
    updateFiscalPeriodTx(tx, companyId, periodId, {
      status: "OPEN",
      reopenedAt: new Date(),
      notes: reason,
    });
    return { id: periodId, name: period.name as string, status: "OPEN" as const };
  });
}

/**
 * Year-end close: sweep every revenue and expense balance into Retained
 * Earnings (§14).
 *
 * The revenue/expense balances come from the `accountPeriodBalances` roll-up.
 * The closing entry is posted in a single transaction; a company with more than
 * ~240 income-statement accounts exceeds Firestore's 500-write limit and needs
 * the BulkWriter fallback (FIREBASE-MIGRATION.md §6) — flagged here rather than
 * silently truncated.
 */
export async function closeFiscalYear(
  companyId: string,
  fiscalYear: number,
  userId: string,
) {
  const company = await getCompanyOrThrow(companyId);
  const { start, end } = fiscalYearRange(fiscalYear, company.fiscalYearStartMonth);

  const balances = await balancesInRange(companyId, start, end);
  const perAccount = new Map<string, { type: AccountType; balance: number }>();
  for (const b of balances) {
    if (b.accountType !== "REVENUE" && b.accountType !== "EXPENSE") continue;
    const prev = perAccount.get(b.accountId);
    const delta = naturalBalance(b.accountType as AccountType, b.debitCents, b.creditCents);
    perAccount.set(b.accountId, {
      type: b.accountType as AccountType,
      balance: (prev?.balance ?? 0) + delta,
    });
  }

  const lines: ManualJournalInput["lines"] = [];
  let netIncome = 0;
  for (const [accountId, { type, balance }] of perAccount) {
    if (balance === 0) continue;
    netIncome += type === "REVENUE" ? balance : -balance;
    const isDebitNatural = NORMAL_BALANCE[type] === "DEBIT";
    lines.push(
      isDebitNatural
        ? { accountId, creditCents: balance, description: `Close FY${fiscalYear}` }
        : { accountId, debitCents: balance, description: `Close FY${fiscalYear}` },
    );
  }
  if (lines.length === 0) throw new Error("There is nothing to close for this fiscal year.");

  if (lines.length > 240) {
    throw new PostingError(
      `Year-end close for ${lines.length} accounts exceeds the single-transaction write limit. The BulkWriter path is not built yet (FIREBASE-MIGRATION.md §6).`,
      "NO_LINES",
    );
  }

  const retainedId = await runTransaction(async (tx) => {
    const existing = await findClosingEntryTx(tx, companyId, end);
    if (existing) {
      throw new Error(`Fiscal ${fiscalYear} has already been closed (${existing.entryNo}).`);
    }
    const retained = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.RETAINED_EARNINGS);
    const allLines = [
      ...lines,
      netIncome >= 0
        ? { accountId: retained.id, creditCents: netIncome, description: `FY${fiscalYear} net income` }
        : { accountId: retained.id, debitCents: -netIncome, description: `FY${fiscalYear} net loss` },
    ];
    const entry = await postJournal(tx, {
      companyId,
      date: end,
      memo: `Year-end close — fiscal ${fiscalYear}`,
      sourceType: "CLOSING",
      createdById: userId,
      allowClosedPeriod: true,
      lines: allLines,
    });
    return entry;
  });

  const locked = await setFiscalYearStatus(companyId, fiscalYear, {
    status: "LOCKED",
    closedAt: new Date(),
    closedById: userId,
  });

  return {
    entry: retainedId,
    netIncomeCents: netIncome,
    nextYearStart: addDays(end, 1),
    periodsLocked: locked,
  };
}

/** Post migrated opening balances against Opening Balance Equity (§6). */
export async function postOpeningBalances(
  companyId: string,
  date: Date,
  balances: { accountId: string; debitCents?: number; creditCents?: number }[],
  userId?: string | null,
) {
  return runTransaction(async (tx) => {
    const obe = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY);
    const debit = balances.reduce((s, b) => s + (b.debitCents ?? 0), 0);
    const credit = balances.reduce((s, b) => s + (b.creditCents ?? 0), 0);
    const diff = debit - credit;

    const lines: ManualJournalInput["lines"] = balances.map((b) => ({
      accountId: b.accountId,
      debitCents: b.debitCents,
      creditCents: b.creditCents,
      description: "Opening balance",
    }));
    if (diff !== 0) {
      lines.push(
        diff > 0
          ? { accountId: obe.id, creditCents: diff, description: "Opening balance equity" }
          : { accountId: obe.id, debitCents: -diff, description: "Opening balance equity" },
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
