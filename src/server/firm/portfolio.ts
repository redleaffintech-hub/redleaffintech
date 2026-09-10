/**
 * The firm workspace (§32). An external accountant works across several client
 * files. Nothing here widens the tenant boundary: the client list is exactly
 * the companies where this user holds an ACCOUNTANT membership.
 */

import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { addMonths, daysBetween, endOfMonth, today } from "@/lib/dates";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { checkLedgerIntegrity } from "@/server/accounting/ledger-fs";
import { apAging, arAging } from "@/server/reports/aging-fs";
import { taxControlReconciliation } from "@/server/reports/tax-fs";
import { accountRawBalanceAsOf } from "@/server/reports/ledger-fs";
import { requireUser } from "@/server/auth/context";
import { getCompany } from "@/server/db/companies";
import { listMembershipsForUser } from "@/server/db/company-users";
import { getAccountsBySystemKeys } from "@/server/db/accounts";
import { firms } from "@/server/db/platform";
import { bills } from "@/server/db/bills";
import { invoices } from "@/server/db/invoices";
import { bankAccounts, listBankTransactions } from "@/server/db/banking";
import { listFiscalPeriods } from "@/server/db/fiscal-periods";
import { listTaxPeriods } from "@/server/db/tax-periods";
import { listTaxEntriesInRange } from "@/server/db/tax-entries";
import { sub } from "@/server/db/firestore";

export interface FirmClient {
  id: string;
  name: string;
  province: string;
  fiscalYearStartMonth: number;
  isReadOnly: boolean;
  baseCurrency: string;
}

export const requireFirmAccess = cache(async () => {
  const user = await requireUser();

  const memberships = (
    await listMembershipsForUser(user.id, { status: "ACTIVE" })
  ).filter((m) => m.role === "ACCOUNTANT");
  if (memberships.length === 0) notFound();

  const companies = await Promise.all(memberships.map((m) => getCompany(m.companyId)));
  const clients = companies
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      province: c.province,
      fiscalYearStartMonth: c.fiscalYearStartMonth,
      isReadOnly: c.isReadOnly,
      baseCurrency: c.baseCurrency,
    })) satisfies FirmClient[];

  const firmId = companies.find((c) => c?.firmId)?.firmId ?? null;
  const firm = firmId ? await firms.get(firmId) : null;

  return { user, firm: firm ? { id: firm.id, name: firm.name } : null, clients };
});

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

async function uncategorizedBalanceCents(companyId: string, asOf: Date) {
  const accounts = await getAccountsBySystemKeys(companyId, [
    SYSTEM_ACCOUNTS.UNCATEGORIZED_INCOME,
    SYSTEM_ACCOUNTS.UNCATEGORIZED_EXPENSE,
  ]);
  if (accounts.length === 0) return 0;
  let total = 0;
  for (const a of accounts) total += await accountRawBalanceAsOf(companyId, a.id, asOf);
  return total;
}

/** Any tax entries dated inside a period? */
async function periodHasTax(companyId: string, from: Date, to: Date): Promise<boolean> {
  const rows = await listTaxEntriesInRange(companyId, from, to);
  return rows.length > 0;
}

export async function clientSnapshot(client: FirmClient): Promise<ClientSnapshot> {
  const asOf = today();
  const currency = client.baseCurrency;

  const [integrity, bankTxns, pendingBills, openInvoices, entriesSnap, periods, taxPeriods, uncategorized] =
    await Promise.all([
      checkLedgerIntegrity(client.id),
      listBankTransactions(client.id, { status: "UNMATCHED" }),
      bills.list(client.id, { where: [["approvalStatus", "==", "PENDING"]] }),
      invoices.list(client.id, {
        where: [["status", "in", ["SENT", "PARTIALLY_PAID", "OVERDUE"]]],
      }),
      sub(client.id, "journalEntries").orderBy("date", "desc").limit(1).get(),
      listFiscalPeriods(client.id),
      listTaxPeriods(client.id),
      uncategorizedBalanceCents(client.id, asOf),
    ]);

  const bankQueue = bankTxns.length;
  const billsAwaitingApproval = pendingBills.length;
  const overdueRows = openInvoices.filter((i) => i.balanceCents > 0 && i.dueDate < asOf);
  const overdueInvoices = overdueRows.length;
  const overdueCents = overdueRows.reduce((s, i) => s + i.balanceCents, 0);
  const periodsBehind = periods.filter((p) => p.status === "OPEN" && p.endDate < asOf).length;
  const lastEntryDate = entriesSnap.empty
    ? null
    : (entriesSnap.docs[0].data().date as FirebaseFirestore.Timestamp).toDate();

  // Earliest OPEN/REVIEW period that has ended and carries tax activity.
  let taxPeriod: { id: string; name: string; status: string; endDate: Date } | null = null;
  for (const p of taxPeriods
    .filter((p) => ["OPEN", "REVIEW"].includes(p.status) && p.endDate < asOf)
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime())) {
    if (await periodHasTax(client.id, p.startDate, p.endDate)) {
      taxPeriod = { id: p.id, name: p.name, status: p.status, endDate: p.endDate };
      break;
    }
  }

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
  if (overdueInvoices > 0) {
    add(
      "info",
      "Receivables overdue",
      `${overdueInvoices} invoices past due, ${formatMoney(overdueCents, { currency })} outstanding.`,
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
    overdueInvoices,
    overdueCents,
    uncategorizedCents: uncategorized,
    lastPostedAt: lastEntryDate,
    openPeriodsBehind: periodsBehind,
    taxPeriod: taxPeriod && dueDate ? { ...taxPeriod, dueDate, daysToDue } : null,
    attention,
  };
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

export async function closeChecklist(
  companyId: string,
  periodId?: string,
): Promise<CloseChecklist | null> {
  const asOf = today();
  const currency = (await getCompany(companyId))?.baseCurrency ?? DEFAULT_CURRENCY;

  const periods = await listFiscalPeriods(companyId);
  const period = periodId
    ? periods.find((p) => p.id === periodId) ?? null
    : periods
        .filter((p) => p.status === "OPEN" && p.endDate < asOf)
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null;
  if (!period) return null;

  const range = { from: period.startDate, to: period.endDate };

  const [integrity, ar, ap, tax, bankTxns, accts, drafts, uncategorized] = await Promise.all([
    checkLedgerIntegrity(companyId),
    arAging(companyId, period.endDate),
    apAging(companyId, period.endDate),
    taxControlReconciliation(companyId, range),
    listBankTransactions(companyId, {
      status: "UNMATCHED",
      from: period.startDate,
      to: period.endDate,
    }),
    bankAccounts.list(companyId, { where: [["isActive", "==", true]] }),
    sub(companyId, "journalEntries")
      .where("status", "==", "DRAFT")
      .where("date", ">=", period.startDate)
      .where("date", "<=", period.endDate)
      .get(),
    uncategorizedBalanceCents(companyId, period.endDate),
  ]);
  const unmatched = bankTxns.length;
  const draftEntries = drafts.size;

  const reconciledThrough = await sub(companyId, "bankReconciliations")
    .where("status", "==", "COMPLETED")
    .get();
  const reconciledIds = new Set(
    reconciledThrough.docs
      .filter((d) => {
        const end = (d.data().statementEndDate as FirebaseFirestore.Timestamp)?.toDate?.();
        return end && end >= period.endDate;
      })
      .map((d) => d.data().bankAccountId as string),
  );
  const unreconciled = accts.filter((a) => !reconciledIds.has(a.id));

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
        accts.length === 0
          ? "No bank accounts on this file."
          : unreconciled.length === 0
            ? "All accounts reconciled through the period end."
            : `Not reconciled: ${unreconciled.map((a) => a.name).join(", ")}.`,
      state: accts.length === 0 ? "attention" : unreconciled.length === 0 ? "pass" : "fail",
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
    readyToClose: checks.every((c) => c.state !== "fail"),
  };
}
