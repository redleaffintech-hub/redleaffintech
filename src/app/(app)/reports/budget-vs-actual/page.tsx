import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { NORMAL_BALANCE, type AccountType } from "@/lib/enums";
import { fiscalYearOf, fiscalYearRange, isoDate, today, toUtcDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { EmptyState, Money, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/filter-bar";
import { ReportSheet, StatementSectionHeader, periodLabel } from "@/components/report-shell";

export const metadata = { title: "Budget vs actual" };

export default async function BudgetVsActualPage({ searchParams }: PageProps<"/reports/budget-vs-actual">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const params = await searchParams;

  const fiscalYear = Number(typeof params.year === "string" ? params.year : fiscalYearOf(today(), company.fiscalYearStartMonth));
  const { start, end } = fiscalYearRange(fiscalYear, company.fiscalYearStartMonth);
  const to = toUtcDay(today()) < end ? toUtcDay(today()) : end;

  const budget = await db.budget.findFirst({
    where: { companyId: company.id, fiscalYear },
    include: { lines: { include: { account: true } } },
  });

  if (!budget) {
    return (
      <>
        <PageHeader title="Budget vs actual" breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Budget vs actual" }]} />
        <EmptyState
          title={`No budget for fiscal ${fiscalYear}`}
          description="Create a budget to compare planned figures against what the ledger actually recorded."
        />
      </>
    );
  }

  // Only the periods that have elapsed count towards the budget-to-date.
  const elapsedPeriods = Math.max(
    1,
    (to.getUTCFullYear() - start.getUTCFullYear()) * 12 + (to.getUTCMonth() - start.getUTCMonth()) + 1,
  );

  const actuals = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { companyId: company.id, date: { gte: start, lte: to }, accountType: { in: ["REVENUE", "EXPENSE"] } },
    _sum: { debitCents: true, creditCents: true },
  });
  const actualById = new Map(
    actuals.map((a) => [a.accountId, { debit: a._sum.debitCents ?? 0, credit: a._sum.creditCents ?? 0 }]),
  );

  const byAccount = new Map<string, { code: string; name: string; type: string; budgetCents: number }>();
  for (const line of budget.lines) {
    if (line.periodNumber > elapsedPeriods) continue;
    const existing = byAccount.get(line.accountId);
    if (existing) existing.budgetCents += line.amountCents;
    else
      byAccount.set(line.accountId, {
        code: line.account.code,
        name: line.account.name,
        type: line.account.type,
        budgetCents: line.amountCents,
      });
  }

  const rows = [...byAccount.entries()]
    .map(([accountId, entry]) => {
      const actual = actualById.get(accountId);
      const actualCents = actual
        ? NORMAL_BALANCE[entry.type as AccountType] === "DEBIT"
          ? actual.debit - actual.credit
          : actual.credit - actual.debit
        : 0;
      const varianceCents = entry.type === "REVENUE" ? actualCents - entry.budgetCents : entry.budgetCents - actualCents;
      return { accountId, ...entry, actualCents, varianceCents };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const revenueRows = rows.filter((r) => r.type === "REVENUE");
  const expenseRows = rows.filter((r) => r.type === "EXPENSE");
  const total = (list: typeof rows, key: "budgetCents" | "actualCents" | "varianceCents") =>
    list.reduce((s, r) => s + r[key], 0);

  return (
    <>
      <PageHeader
        title="Budget vs actual"
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Budget vs actual" }]}
        description={`${budget.name} — budget prorated across the ${elapsedPeriods} period(s) elapsed so far.`}
      />

      <ReportSheet
        companyName={company.name}
        title="Budget vs Actual"
        periodLabel={periodLabel(start, to)}
        basisNote="Favourable variance is more revenue or less spend than budgeted."
        toolbar={<PrintButton />}
      >
        <table className="w-full text-[0.8125rem]">
          <thead>
            <tr className="border-b border-paper-300">
              <th className="pb-2 pr-4 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Account</th>
              <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Budget</th>
              <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Actual</th>
              <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Variance</th>
              <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">%</th>
            </tr>
          </thead>
          <tbody>
            <StatementSectionHeader label="Revenue" colSpan={5} />
            {revenueRows.map((row) => <Row key={row.accountId} row={row} />)}
            <TotalRow label="Total revenue" budget={total(revenueRows, "budgetCents")} actual={total(revenueRows, "actualCents")} variance={total(revenueRows, "varianceCents")} />

            <StatementSectionHeader label="Expenses" colSpan={5} />
            {expenseRows.map((row) => <Row key={row.accountId} row={row} />)}
            <TotalRow label="Total expenses" budget={total(expenseRows, "budgetCents")} actual={total(expenseRows, "actualCents")} variance={total(expenseRows, "varianceCents")} />

            <TotalRow
              label="Net income"
              budget={total(revenueRows, "budgetCents") - total(expenseRows, "budgetCents")}
              actual={total(revenueRows, "actualCents") - total(expenseRows, "actualCents")}
              variance={total(rows, "varianceCents")}
              emphasis
            />
          </tbody>
        </table>
      </ReportSheet>
    </>
  );
}

function Row({ row }: { row: { code: string; name: string; budgetCents: number; actualCents: number; varianceCents: number } }) {
  const percent = row.budgetCents ? (row.varianceCents / Math.abs(row.budgetCents)) * 100 : null;
  return (
    <tr className="border-b border-paper-200 hover:bg-paper-100">
      <td className="py-2 pr-4">
        <span className="tnum mr-2 text-[0.75rem] text-muted-ink">{row.code}</span>
        <span className="text-ink-800">{row.name}</span>
      </td>
      <td className="py-2 pl-4 text-right"><Money cents={row.budgetCents} /></td>
      <td className="py-2 pl-4 text-right"><Money cents={row.actualCents} /></td>
      <td className="py-2 pl-4 text-right">
        <Money cents={row.varianceCents} className={row.varianceCents >= 0 ? "text-positive" : "text-negative"} />
      </td>
      <td className="tnum py-2 pl-4 text-right text-muted-ink">{percent === null ? "—" : `${percent.toFixed(0)}%`}</td>
    </tr>
  );
}

function TotalRow({
  label, budget, actual, variance, emphasis,
}: {
  label: string; budget: number; actual: number; variance: number; emphasis?: boolean;
}) {
  return (
    <tr className={emphasis ? "border-t-2 border-ink-900" : "border-t border-paper-400"}>
      <td className="py-2.5 pr-4 font-semibold text-ink-950">{label}</td>
      <td className="py-2.5 pl-4 text-right"><Money cents={budget} bold /></td>
      <td className="py-2.5 pl-4 text-right"><Money cents={actual} bold /></td>
      <td className="py-2.5 pl-4 text-right">
        <Money cents={variance} bold className={variance >= 0 ? "text-positive" : "text-negative"} />
      </td>
      <td className="tnum py-2.5 pl-4 text-right text-muted-ink">
        {budget ? `${((variance / Math.abs(budget)) * 100).toFixed(0)}%` : "—"}
      </td>
    </tr>
  );
}
