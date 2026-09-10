import "server-only";

/**
 * Dashboard aggregates (§4) — Firestore implementation. Every number is a view
 * onto the same ledger/subledger data the statements use.
 *
 * `bankQueue` and `unpaidRecurring` read collections that Phase 5d migrates
 * (banking, recurring); before then they are simply 0.
 */

import { CASH_ASSET_SUBTYPES } from "@/lib/enums";
import {
  addDays,
  addMonths,
  endOfMonth,
  fiscalYearOf,
  fiscalYearRange,
  monthsBetween,
  startOfMonth,
  today,
} from "@/lib/dates";
import { getCompanyOrThrow } from "@/server/db/companies";
import { listAccounts } from "@/server/db/accounts";
import { listFiscalPeriods } from "@/server/db/fiscal-periods";
import { sub } from "@/server/db/firestore";
import { apAging, arAging, bucketLabels, DEFAULT_BUCKETS } from "./aging";
import { monthlyPerformance, profitAndLoss } from "./financials";
import { accountRawBalanceAsOf } from "./ledger";
import { taxSummary } from "./tax";

function shortMonth(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" }).format(date);
}
function monthsElapsed(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

export async function dashboardData(companyId: string) {
  const asOf = today();
  const company = await getCompanyOrThrow(companyId);

  const fiscalYear = fiscalYearOf(asOf, company.fiscalYearStartMonth);
  const { start: fyStart } = fiscalYearRange(fiscalYear, company.fiscalYearStartMonth);
  const priorFy = fiscalYearRange(fiscalYear - 1, company.fiscalYearStartMonth);
  const ytd = { from: fyStart, to: asOf };
  const chartRange = {
    from:
      monthsBetween(fyStart, asOf).length >= 4
        ? fyStart
        : startOfMonth(addMonths(asOf, -5)),
    to: asOf,
  };

  const accounts = await listAccounts(companyId);
  const cashSubtypes = CASH_ASSET_SUBTYPES as readonly string[];
  const cashAccounts = accounts.filter(
    (a) => a.isActive && [...cashSubtypes, "CREDIT_CARD"].includes(a.subtype),
  );

  const [pl, priorPl, performance, ar, ap, tax] = await Promise.all([
    profitAndLoss(companyId, ytd),
    profitAndLoss(companyId, {
      from: priorFy.start,
      to: addMonths(priorFy.start, monthsElapsed(fyStart, asOf)),
    }),
    monthlyPerformance(companyId, chartRange),
    arAging(companyId, asOf),
    apAging(companyId, asOf),
    currentTaxPosition(companyId, asOf),
  ]);

  // Cash on hand + monthly trend from the bank/cash account balances.
  const cashAccountIds = cashAccounts
    .filter((a) => cashSubtypes.includes(a.subtype))
    .map((a) => a.id);
  const cardAccountIds = cashAccounts.filter((a) => a.subtype === "CREDIT_CARD").map((a) => a.id);

  const months = monthsBetween(chartRange.from, asOf);
  const cashTrend: { label: string; value: number }[] = [];
  for (const month of months) {
    let total = 0;
    for (const id of cashAccountIds) {
      total += await accountRawBalanceAsOf(companyId, id, endOfMonth(month));
    }
    cashTrend.push({ label: shortMonth(month), value: total });
  }
  let cashOnHandCents = 0;
  for (const id of cashAccountIds) cashOnHandCents += await accountRawBalanceAsOf(companyId, id, asOf);
  let creditCardOwingCents = 0;
  for (const id of cardAccountIds) creditCardOwingCents += -(await accountRawBalanceAsOf(companyId, id, asOf));

  const recentSnap = await sub(companyId, "journalEntries").orderBy("date", "desc").limit(8).get();
  const recentEntries = recentSnap.docs.map((d) => {
    const r = d.data();
    return {
      id: d.id,
      entryNo: r.entryNo,
      date: (r.date as FirebaseFirestore.Timestamp).toDate(),
      memo: r.memo ?? null,
      sourceType: r.sourceType,
      sourceNumber: r.sourceNumber ?? null,
      totalDebitCents: r.totalDebitCents ?? 0,
      status: r.status,
    };
  });

  const periods = (await listFiscalPeriods(companyId, { fiscalYear })).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    startDate: p.startDate,
    endDate: p.endDate,
    periodNumber: p.periodNumber,
  }));

  const bankQueue = (
    await sub(companyId, "bankTransactions").where("status", "==", "UNMATCHED").get()
  ).size;
  const unpaidRecurring = (
    await sub(companyId, "recurring").where("isActive", "==", true).get()
  ).size;

  const dueSoonCents = ap.rows
    .flatMap((r) => r.documents)
    .filter((d) => d.dueDate <= addDays(asOf, 7) && d.balanceCents > 0)
    .reduce((s, d) => s + d.balanceCents, 0);

  const labels = bucketLabels(DEFAULT_BUCKETS);

  return {
    asOf,
    fiscalYear,
    province: company.province,
    kpis: {
      cashOnHandCents,
      creditCardOwingCents,
      revenueCents: pl.revenueCents,
      priorRevenueCents: priorPl.revenueCents,
      expenseCents: pl.totalExpenseCents,
      priorExpenseCents: priorPl.totalExpenseCents,
      netIncomeCents: pl.netIncomeCents,
      priorNetIncomeCents: priorPl.netIncomeCents,
      grossMarginPercent:
        pl.revenueCents > 0 ? (pl.grossProfitCents / pl.revenueCents) * 100 : 0,
    },
    cashTrend,
    chartFrom: chartRange.from,
    performance: performance.map((p) => ({
      label: shortMonth(p.month),
      a: p.revenueCents,
      b: p.expenseCents,
    })),
    ar: {
      totalCents: ar.totals.totalCents,
      overdueCents: ar.totals.overdueCents,
      buckets: [
        { label: labels[0], value: ar.totals.currentCents },
        ...ar.totals.buckets.map((value, index) => ({ label: labels[index + 1], value })),
      ],
      top: ar.rows.slice(0, 5),
      reconciled: ar.reconciliation.reconciled,
    },
    ap: {
      totalCents: ap.totals.totalCents,
      overdueCents: ap.totals.overdueCents,
      dueSoonCents,
      buckets: [
        { label: labels[0], value: ap.totals.currentCents },
        ...ap.totals.buckets.map((value, index) => ({ label: labels[index + 1], value })),
      ],
      top: ap.rows.slice(0, 5),
      reconciled: ap.reconciliation.reconciled,
    },
    tax,
    bankQueue,
    recentEntries,
    periods,
    unpaidRecurring,
  };
}

async function currentTaxPosition(companyId: string, asOf: Date) {
  const snap = await sub(companyId, "taxPeriods")
    .where("startDate", "<=", asOf)
    .orderBy("startDate", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const p = snap.docs[0].data();
  const startDate = (p.startDate as FirebaseFirestore.Timestamp).toDate();
  const endDate = (p.endDate as FirebaseFirestore.Timestamp).toDate();
  if (endDate < asOf) return null;

  const summary = await taxSummary(companyId, { from: startDate, to: endDate });
  const dueDate = endOfMonth(addMonths(endDate, 1));
  return {
    periodId: snap.docs[0].id,
    periodName: p.name,
    status: p.status,
    startDate,
    endDate,
    dueDate,
    daysUntilDue: Math.round((dueDate.getTime() - asOf.getTime()) / 86_400_000),
    collectedCents: summary.totals.taxCollectedCents,
    recoverableCents: summary.totals.recoverableCents,
    netCents: summary.totals.netCents,
    reconciled: summary.reconciliation.reconciled,
  };
}
