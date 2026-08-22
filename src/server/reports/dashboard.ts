/**
 * Dashboard aggregates (spec §4 Dashboard: KPIs, cash, revenue, expenses,
 * AR/AP, tax, alerts).
 *
 * Every number here is derived from the ledger or the subledgers — the tiles
 * are a view onto the same data the statements use, never a separate tally.
 */

import { db } from "@/lib/db";
import { addDays, addMonths, endOfMonth, monthsBetween, startOfMonth, today, utcDate, fiscalYearOf, fiscalYearRange } from "@/lib/dates";
import { arAging, apAging, DEFAULT_BUCKETS, bucketLabels } from "./aging";
import { monthlyPerformance, profitAndLoss } from "./financials";
import { taxSummary } from "./tax";

export async function dashboardData(companyId: string) {
  const asOf = today();
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { fiscalYearStartMonth: true, province: true },
  });

  const fiscalYear = fiscalYearOf(asOf, company.fiscalYearStartMonth);
  const { start: fyStart } = fiscalYearRange(fiscalYear, company.fiscalYearStartMonth);
  const priorFy = fiscalYearRange(fiscalYear - 1, company.fiscalYearStartMonth);
  const ytd = { from: fyStart, to: asOf };
  // Charts cover the fiscal year to date, extended backwards only if the year
  // is young, so the axis never opens with a run of empty months.
  const chartRange = {
    from: monthsBetween(fyStart, asOf).length >= 4 ? fyStart : startOfMonth(addMonths(asOf, -5)),
    to: asOf,
  };

  const [pl, priorPl, performance, ar, ap, cashAccounts, bankQueue, tax, recentEntries, periods, unpaidRecurring] =
    await Promise.all([
      profitAndLoss(companyId, ytd),
      profitAndLoss(companyId, { from: priorFy.start, to: addMonths(priorFy.start, monthsElapsed(fyStart, asOf)) }),
      monthlyPerformance(companyId, chartRange),
      arAging(companyId, asOf),
      apAging(companyId, asOf),
      db.account.findMany({
        where: { companyId, subtype: { in: ["BANK", "CREDIT_CARD"] }, isActive: true },
        select: { id: true, code: true, name: true, subtype: true, type: true },
        orderBy: { code: "asc" },
      }),
      db.bankTransaction.count({ where: { companyId, status: "UNMATCHED" } }),
      currentTaxPosition(companyId, asOf),
      db.journalEntry.findMany({
        where: { companyId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 8,
        select: { id: true, entryNo: true, date: true, memo: true, sourceType: true, sourceNumber: true, totalDebitCents: true, status: true },
      }),
      db.fiscalPeriod.findMany({
        where: { companyId, fiscalYear },
        orderBy: { periodNumber: "asc" },
        select: { id: true, name: true, status: true, startDate: true, endDate: true, periodNumber: true },
      }),
      db.recurringTemplate.count({ where: { companyId, isActive: true } }),
    ]);

  // Cash: closing balance per month across every bank & cash account.
  const cashLines = await db.journalLine.findMany({
    where: { companyId, accountId: { in: cashAccounts.filter((a) => a.subtype === "BANK").map((a) => a.id) } },
    select: { date: true, debitCents: true, creditCents: true },
    orderBy: { date: "asc" },
  });

  const months = monthsBetween(chartRange.from, asOf);
  let running = 0;
  let cursor = 0;
  const cashTrend = months.map((month) => {
    const cutoff = endOfMonth(month);
    while (cursor < cashLines.length && cashLines[cursor].date <= cutoff) {
      running += cashLines[cursor].debitCents - cashLines[cursor].creditCents;
      cursor++;
    }
    return { label: shortMonth(month), value: running };
  });
  const cashOnHandCents = cashLines.reduce((s, l) => s + l.debitCents - l.creditCents, 0);

  const cardBalances = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { companyId, accountId: { in: cashAccounts.filter((a) => a.subtype === "CREDIT_CARD").map((a) => a.id) } },
    _sum: { debitCents: true, creditCents: true },
  });
  const creditCardOwingCents = cardBalances.reduce(
    (s, c) => s + ((c._sum.creditCents ?? 0) - (c._sum.debitCents ?? 0)),
    0,
  );

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
      grossMarginPercent: pl.revenueCents > 0 ? (pl.grossProfitCents / pl.revenueCents) * 100 : 0,
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
  const period = await db.taxPeriod.findFirst({
    where: { companyId, startDate: { lte: asOf }, endDate: { gte: asOf } },
  });
  if (!period) return null;

  const summary = await taxSummary(companyId, { from: period.startDate, to: period.endDate });
  const dueDate = addDays(endOfMonth(addMonths(period.endDate, 1)), 0);

  return {
    periodId: period.id,
    periodName: period.name,
    status: period.status,
    startDate: period.startDate,
    endDate: period.endDate,
    dueDate,
    daysUntilDue: Math.round((dueDate.getTime() - asOf.getTime()) / 86_400_000),
    collectedCents: summary.totals.taxCollectedCents,
    recoverableCents: summary.totals.recoverableCents,
    netCents: summary.totals.netCents,
    reconciled: summary.reconciliation.reconciled,
  };
}

function monthsElapsed(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

function shortMonth(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" }).format(date);
}

export { utcDate };
