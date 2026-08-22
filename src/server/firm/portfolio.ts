/**
 * The firm workspace (spec §32 — Firm workspace: client dashboard, review
 * queue, close checklist).
 *
 * An external accountant works across several client files at once. Nothing
 * here widens the tenant boundary: the list of clients is exactly the set of
 * companies where this user holds an ACCOUNTANT membership, and every figure is
 * still read through that company's own id.
 */

import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { addMonths, endOfMonth, daysBetween, today } from "@/lib/dates";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import { checkLedgerIntegrity } from "@/server/accounting/ledger";
import { apAging, arAging } from "@/server/reports/aging";
import { taxControlReconciliation } from "@/server/reports/tax";
import { requireUser } from "@/server/auth/context";
import { DEFAULT_CURRENCY } from "@/lib/currency";

export interface FirmClient {
  id: string;
  name: string;
  province: string;
  fiscalYearStartMonth: number;
  isReadOnly: boolean;
  /** Each client keeps its own books — never format one in another's currency. */
  baseCurrency: string;
}

/**
 * Gate for every /firm screen. A user with no accountant engagement has no firm
 * workspace at all — not an empty one.
 */
export const requireFirmAccess = cache(async () => {
  const user = await requireUser();

  const memberships = await db.companyUser.findMany({
    where: { userId: user.id, role: "ACCOUNTANT", status: "ACTIVE" },
    include: {
      company: {
        select: {
          id: true, name: true, province: true, fiscalYearStartMonth: true,
          isReadOnly: true, baseCurrency: true, firmId: true,
        },
      },
    },
    orderBy: { company: { name: "asc" } },
  });
  if (memberships.length === 0) notFound();

  const firmId = memberships.find((m) => m.company.firmId)?.company.firmId ?? null;
  const firm = firmId ? await db.firm.findUnique({ where: { id: firmId }, select: { id: true, name: true } }) : null;

  return {
    user,
    firm,
    clients: memberships.map((m) => ({
      id: m.company.id,
      name: m.company.name,
      province: m.company.province,
      fiscalYearStartMonth: m.company.fiscalYearStartMonth,
      isReadOnly: m.company.isReadOnly,
      baseCurrency: m.company.baseCurrency,
    })) satisfies FirmClient[],
  };
});

/** Confirms one company id is genuinely on this accountant's client list. */
export async function requireFirmClient(companyId: string | undefined) {
  const { clients, user, firm } = await requireFirmAccess();
  const client = companyId ? clients.find((c) => c.id === companyId) : clients[0];
  if (!client) notFound();
  return { client, clients, user, firm };
}

export type Severity = "critical" | "warning" | "info";

export interface AttentionItem {
  companyId: string;
  companyName: string;
  severity: Severity;
  title: string;
  detail: string;
  href: string;
}

export interface ClientSnapshot {
  client: FirmClient;
  ledgerBalanced: boolean;
  outOfBalanceCents: number;
  equationGapCents: number;
  bankQueue: number;
  billsAwaitingApproval: number;
  overdueInvoices: number;
  overdueCents: number;
  uncategorizedCents: number;
  lastPostedAt: Date | null;
  openPeriodsBehind: number;
  taxPeriod: { id: string; name: string; status: string; dueDate: Date; daysToDue: number } | null;
  attention: AttentionItem[];
}

/**
 * One client's health in a handful of indexed counts. Deliberately cheap: the
 * dashboard runs this for every client on the list, so nothing here walks the
 * ledger line by line.
 */
export async function clientSnapshot(client: FirmClient): Promise<ClientSnapshot> {
  const asOf = today();
  const currency = client.baseCurrency;

  const [integrity, bankQueue, billsAwaitingApproval, overdue, lastEntry, periodsBehind, taxPeriod, uncategorized] =
    await Promise.all([
      checkLedgerIntegrity(db, client.id),
      db.bankTransaction.count({ where: { companyId: client.id, status: "UNMATCHED" } }),
      db.bill.count({ where: { companyId: client.id, approvalStatus: "PENDING" } }),
      db.invoice.aggregate({
        where: {
          companyId: client.id,
          status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
          balanceCents: { gt: 0 },
          dueDate: { lt: asOf },
        },
        _count: { _all: true },
        _sum: { balanceCents: true },
      }),
      db.journalEntry.findFirst({
        where: { companyId: client.id },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: { date: true },
      }),
      // Periods that have ended but are still open — the close backlog.
      db.fiscalPeriod.count({ where: { companyId: client.id, status: "OPEN", endDate: { lt: asOf } } }),
      // Only periods with something in them. A registrant does have to file a
      // nil return, but the calendar routinely runs back before the company
      // traded, and flagging those empty quarters would bury the real ones.
      db.taxPeriod.findFirst({
        where: {
          companyId: client.id,
          status: { in: ["OPEN", "REVIEW"] },
          endDate: { lt: asOf },
          taxEntries: { some: {} },
        },
        orderBy: { endDate: "asc" },
        select: { id: true, name: true, status: true, endDate: true },
      }),
      uncategorizedBalanceCents(client.id),
    ]);

  const attention: AttentionItem[] = [];
  const add = (severity: Severity, title: string, detail: string, href: string) =>
    attention.push({ companyId: client.id, companyName: client.name, severity, title, detail, href });

  if (!integrity.balanced) {
    add(
      "critical",
      "Ledger is out of balance",
      `Debits and credits differ by ${formatMoney(Math.abs(integrity.outOfBalanceCents), { currency })}.`,
      "/accounting/trial-balance",
    );
  }
  if (integrity.equationGapCents !== 0) {
    add(
      "critical",
      "Balance sheet does not balance",
      `Assets less liabilities, equity and earnings leaves ${formatMoney(integrity.equationGapCents, { currency })}.`,
      "/reports/balance-sheet",
    );
  }

  const dueDate = taxPeriod ? endOfMonth(addMonths(taxPeriod.endDate, 1)) : null;
  const daysToDue = dueDate ? daysBetween(asOf, dueDate) : 0;
  if (taxPeriod && dueDate) {
    if (daysToDue < 0) {
      add("critical", "Tax return past due", `${taxPeriod.name} was due ${-daysToDue} days ago.`, "/tax");
    } else if (daysToDue <= 21) {
      add("warning", "Tax return due soon", `${taxPeriod.name} is due in ${daysToDue} days.`, "/tax");
    }
  }

  if (billsAwaitingApproval > 0) {
    add("warning", "Bills awaiting approval", `${billsAwaitingApproval} waiting on a reviewer.`, "/purchases/bills");
  }
  if (bankQueue > 0) {
    add("warning", "Bank items uncategorised", `${bankQueue} transactions in the review queue.`, "/banking");
  }
  if (uncategorized !== 0) {
    add(
      "warning",
      "Uncategorised accounts hold a balance",
      `${formatMoney(Math.abs(uncategorized), { currency })} still sits in uncategorised income or expense.`,
      "/accounting/general-ledger",
    );
  }
  if (periodsBehind > 2) {
    add("info", "Periods left open", `${periodsBehind} finished periods are still open.`, "/accounting/periods");
  }
  if ((overdue._count._all ?? 0) > 0) {
    add(
      "info",
      "Receivables overdue",
      `${overdue._count._all} invoices past due, ${formatMoney(overdue._sum.balanceCents ?? 0, { currency })} outstanding.`,
      "/reports/ar-aging",
    );
  }

  return {
    client,
    ledgerBalanced: integrity.balanced && integrity.equationGapCents === 0,
    outOfBalanceCents: integrity.outOfBalanceCents,
    equationGapCents: integrity.equationGapCents,
    bankQueue,
    billsAwaitingApproval,
    overdueInvoices: overdue._count._all ?? 0,
    overdueCents: overdue._sum.balanceCents ?? 0,
    uncategorizedCents: uncategorized,
    lastPostedAt: lastEntry?.date ?? null,
    openPeriodsBehind: periodsBehind,
    taxPeriod:
      taxPeriod && dueDate
        ? { id: taxPeriod.id, name: taxPeriod.name, status: taxPeriod.status, dueDate, daysToDue }
        : null,
  attention,
  };
}

/** Net balance sitting in the two uncategorised holding accounts. */
async function uncategorizedBalanceCents(companyId: string) {
  const accounts = await db.account.findMany({
    where: {
      companyId,
      systemKey: { in: [SYSTEM_ACCOUNTS.UNCATEGORIZED_INCOME, SYSTEM_ACCOUNTS.UNCATEGORIZED_EXPENSE] },
    },
    select: { id: true },
  });
  if (accounts.length === 0) return 0;

  const totals = await db.journalLine.aggregate({
    where: { companyId, accountId: { in: accounts.map((a) => a.id) } },
    _sum: { debitCents: true, creditCents: true },
  });
  return (totals._sum.debitCents ?? 0) - (totals._sum.creditCents ?? 0);
}

// ── Close checklist ─────────────────────────────────────────────────────────

export interface CloseCheck {
  key: string;
  label: string;
  detail: string;
  state: "pass" | "fail" | "attention";
  href?: string;
}

export interface CloseChecklist {
  period: { id: string; name: string; status: string; startDate: Date; endDate: Date; fiscalYear: number };
  checks: CloseCheck[];
  readyToClose: boolean;
}

/**
 * What has to be true before a month is closed. Each check is the same
 * reconciliation the reports themselves perform, so a green checklist and a
 * clean set of statements can never disagree.
 */
export async function closeChecklist(companyId: string, periodId?: string): Promise<CloseChecklist | null> {
  const asOf = today();
  // Only an id is passed in, so the currency has to be fetched: a firm's
  // clients do not necessarily share one.
  const currency =
    (await db.company.findUnique({ where: { id: companyId }, select: { baseCurrency: true } }))?.baseCurrency ??
    DEFAULT_CURRENCY;
  const period = periodId
    ? await db.fiscalPeriod.findFirst({ where: { id: periodId, companyId } })
    : await db.fiscalPeriod.findFirst({
        where: { companyId, status: "OPEN", endDate: { lt: asOf } },
        orderBy: { startDate: "asc" },
      });
  if (!period) return null;

  const range = { from: period.startDate, to: period.endDate };

  const [integrity, ar, ap, tax, unmatched, bankAccounts, draftEntries, uncategorized] = await Promise.all([
    checkLedgerIntegrity(db, companyId),
    arAging(companyId, period.endDate),
    apAging(companyId, period.endDate),
    taxControlReconciliation(companyId, range),
    db.bankTransaction.count({
      where: { companyId, status: "UNMATCHED", date: { gte: period.startDate, lte: period.endDate } },
    }),
    db.bankAccount.findMany({ where: { companyId, isActive: true }, select: { id: true, name: true } }),
    db.journalEntry.count({ where: { companyId, status: "DRAFT", date: { gte: period.startDate, lte: period.endDate } } }),
    uncategorizedBalanceCents(companyId),
  ]);

  const reconciledThrough = await db.bankReconciliation.findMany({
    where: { companyId, status: "COMPLETED", statementEndDate: { gte: period.endDate } },
    select: { bankAccountId: true },
  });
  const reconciledIds = new Set(reconciledThrough.map((r) => r.bankAccountId));
  const unreconciled = bankAccounts.filter((account) => !reconciledIds.has(account.id));

  const checks: CloseCheck[] = [
    {
      key: "ledger",
      label: "The ledger balances",
      detail: integrity.balanced
        ? "Total debits equal total credits."
        : `Out of balance by ${formatMoney(Math.abs(integrity.outOfBalanceCents), { currency })}.`,
      state: integrity.balanced ? "pass" : "fail",
      href: "/accounting/trial-balance",
    },
    {
      key: "equation",
      label: "Assets equal liabilities plus equity",
      detail:
        integrity.equationGapCents === 0
          ? "The accounting equation holds."
          : `Gap of ${formatMoney(integrity.equationGapCents, { currency })}.`,
      state: integrity.equationGapCents === 0 ? "pass" : "fail",
      href: "/reports/balance-sheet",
    },
    {
      key: "bank-queue",
      label: "Bank feed is cleared",
      detail:
        unmatched === 0
          ? "No uncategorised transactions dated in the period."
          : `${unmatched} transactions still in the review queue.`,
      state: unmatched === 0 ? "pass" : "fail",
      href: "/banking",
    },
    {
      key: "bank-rec",
      label: "Every bank account is reconciled",
      detail:
        bankAccounts.length === 0
          ? "No bank accounts on this file."
          : unreconciled.length === 0
            ? "All accounts reconciled through the period end."
            : `Not reconciled: ${unreconciled.map((a) => a.name).join(", ")}.`,
      state: bankAccounts.length === 0 ? "attention" : unreconciled.length === 0 ? "pass" : "fail",
      href: "/banking/reconcile",
    },
    {
      key: "ar",
      label: "A/R aging ties to the control account",
      detail: ar.reconciliation.reconciled
        ? "The subledger agrees with the general ledger."
        : `Subledger ${formatMoney(ar.reconciliation.subledgerTotalCents, { currency })} vs GL ${formatMoney(ar.reconciliation.controlAccountCents, { currency })}.`,
      state: ar.reconciliation.reconciled ? "pass" : "fail",
      href: "/reports/ar-aging",
    },
    {
      key: "ap",
      label: "A/P aging ties to the control account",
      detail: ap.reconciliation.reconciled
        ? "The subledger agrees with the general ledger."
        : `Subledger ${formatMoney(ap.reconciliation.subledgerTotalCents, { currency })} vs GL ${formatMoney(ap.reconciliation.controlAccountCents, { currency })}.`,
      state: ap.reconciliation.reconciled ? "pass" : "fail",
      href: "/reports/ap-aging",
    },
    {
      key: "tax",
      label: "Tax subledger ties to the control accounts",
      detail: tax.reconciled
        ? "Tax collected and input credits agree with the ledger."
        : `Collected differs by ${formatMoney(tax.collectedDifferenceCents, { currency })}, ITCs by ${formatMoney(tax.recoverableDifferenceCents, { currency })}.`,
      state: tax.reconciled ? "pass" : "fail",
      href: "/reports/tax-summary",
    },
    {
      key: "uncategorized",
      label: "Nothing left uncategorised",
      detail:
        uncategorized === 0
          ? "The holding accounts are clear."
          : `${formatMoney(Math.abs(uncategorized), { currency })} still sits in uncategorised income or expense.`,
      state: uncategorized === 0 ? "pass" : "attention",
      href: "/accounting/general-ledger",
    },
    {
      key: "drafts",
      label: "No draft journals in the period",
      detail: draftEntries === 0 ? "Every entry in the period is posted." : `${draftEntries} drafts are unposted.`,
      state: draftEntries === 0 ? "pass" : "attention",
      href: "/accounting/journals",
    },
  ];

  return {
    period: {
      id: period.id,
      name: period.name,
      status: period.status,
      startDate: period.startDate,
      endDate: period.endDate,
      fiscalYear: period.fiscalYear,
    },
    checks,
    readyToClose: checks.every((check) => check.state !== "fail"),
  };
}
