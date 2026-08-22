import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { profitAndLoss, monthlyPerformance } from "@/server/reports/financials";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today, addMonths } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PageHeader, Money } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { GroupedBarChart } from "@/components/charts";
import { ReportSheet, StatementRow, StatementSectionHeader, periodLabel } from "@/components/report-shell";

export const metadata = { title: "Profit & loss" };

export default async function ProfitAndLossPage({ searchParams }: PageProps<"/reports/profit-and-loss">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const params = await searchParams;

  const fiscalYear = fiscalYearOf(today(), company.fiscalYearStartMonth);
  const defaults = fiscalYearRange(fiscalYear, company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));

  // Same window, one year earlier — the comparison column.
  const comparison = { from: addMonths(from, -12), to: addMonths(to, -12) };

  const [report, monthly] = await Promise.all([
    profitAndLoss(company.id, { from, to }, comparison),
    monthlyPerformance(company.id, { from, to }),
  ]);

  const find = (key: string) => report.sections.find((s) => s.key === key)!;
  const revenue = find("REVENUE");
  const cogs = find("COST_OF_SALES");
  const opex = find("OPERATING_EXPENSE");
  const otherIncome = find("OTHER_INCOME");
  const otherExpense = find("OTHER_EXPENSE");

  const glLink = (accountId: string) =>
    `/accounting/general-ledger?account=${accountId}&from=${isoDate(from)}&to=${isoDate(to)}`;

  return (
    <>
      <PageHeader
        title="Profit & loss"
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Profit & loss" }]}
        description="Click any account to open its general ledger for the same period."
      />

      <ReportSheet
        companyName={company.name}
        title="Profit & Loss"
        periodLabel={periodLabel(from, to)}
        toolbar={
          <>
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
            <PrintButton />
          </>
        }
      >
        <div className="no-print mb-6 rounded-lg border border-paper-300 p-4">
          <GroupedBarChart
            points={monthly.map((m) => ({
              label: new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" }).format(m.month),
              a: m.revenueCents,
              b: m.expenseCents,
            }))}
            height={180}
          />
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b border-paper-300">
              <th className="pb-2 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                Account
              </th>
              <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                This period
              </th>
              <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                Prior year
              </th>
            </tr>
          </thead>
          <tbody>
            <StatementSectionHeader label="Revenue" />
            {revenue.rows.map((row) => (
              <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
            ))}
            <StatementRow label="Total revenue" value={revenue.totalCents} comparison={revenue.comparisonTotalCents} total />

            {cogs.rows.length > 0 && (
              <>
                <StatementSectionHeader label="Cost of sales" />
                {cogs.rows.map((row) => (
                  <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
                ))}
                <StatementRow label="Total cost of sales" value={cogs.totalCents} comparison={cogs.comparisonTotalCents} total />
                <StatementRow
                  label="Gross profit"
                  value={report.grossProfitCents}
                  comparison={(revenue.comparisonTotalCents ?? 0) - (cogs.comparisonTotalCents ?? 0)}
                  emphasis
                />
              </>
            )}

            <StatementSectionHeader label="Operating expenses" />
            {opex.rows.map((row) => (
              <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
            ))}
            <StatementRow label="Total operating expenses" value={opex.totalCents} comparison={opex.comparisonTotalCents} total />
            <StatementRow
              label="Operating income"
              value={report.operatingIncomeCents}
              comparison={(revenue.comparisonTotalCents ?? 0) - (cogs.comparisonTotalCents ?? 0) - (opex.comparisonTotalCents ?? 0)}
              emphasis
            />

            {(otherIncome.rows.length > 0 || otherExpense.rows.length > 0) && (
              <>
                <StatementSectionHeader label="Other income & expenses" />
                {otherIncome.rows.map((row) => (
                  <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
                ))}
                {otherExpense.rows.map((row) => (
                  <StatementRow key={row.accountId} label={row.name} code={row.code} value={-row.balanceCents} comparison={-(row.comparisonCents ?? 0)} href={glLink(row.accountId)} indent={1} />
                ))}
              </>
            )}

            <StatementRow
              label="Net income"
              value={report.netIncomeCents}
              comparison={report.comparisonNetIncomeCents}
              emphasis
            />
          </tbody>
        </table>

        <div className="mt-6 grid gap-3 border-t border-paper-300 pt-5 sm:grid-cols-3">
          <Metric label="Gross margin" value={report.revenueCents > 0 ? `${((report.grossProfitCents / report.revenueCents) * 100).toFixed(1)}%` : "—"} />
          <Metric label="Net margin" value={report.revenueCents > 0 ? `${((report.netIncomeCents / report.revenueCents) * 100).toFixed(1)}%` : "—"} />
          <Metric
            label="Change vs prior year"
            value={
              report.comparisonNetIncomeCents
                ? `${(((report.netIncomeCents - report.comparisonNetIncomeCents) / Math.abs(report.comparisonNetIncomeCents)) * 100).toFixed(1)}%`
                : "No prior data"
            }
          />
        </div>
      </ReportSheet>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-paper-100 px-3 py-2.5">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className="tnum mt-0.5 text-[1.125rem] font-semibold text-ink-950">{value}</p>
    </div>
  );
}
