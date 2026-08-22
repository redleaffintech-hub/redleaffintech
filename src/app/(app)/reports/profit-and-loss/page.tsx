import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { profitAndLoss, monthlyPerformance, type StatementSection } from "@/server/reports/financials";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today, addMonths } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
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
  const depreciation = find("DEPRECIATION_AMORTIZATION");
  const otherIncome = find("OTHER_INCOME");
  const otherExpense = find("OTHER_EXPENSE");
  const interest = find("INTEREST_EXPENSE");
  const incomeTax = find("INCOME_TAX_EXPENSE");

  const glLink = (accountId: string) =>
    `/accounting/general-ledger?account=${accountId}&from=${isoDate(from)}&to=${isoDate(to)}`;

  /** Accounts of a section, each drilling through to its ledger. */
  const rowsOf = (section: StatementSection, negate = false) =>
    section.rows.map((row) => (
      <StatementRow
        key={row.accountId}
        label={row.name}
        code={row.code}
        value={negate ? -row.balanceCents : row.balanceCents}
        comparison={negate ? -(row.comparisonCents ?? 0) : row.comparisonCents}
        href={glLink(row.accountId)}
        indent={1}
      />
    ));

  const percent = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);

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
            <ExportCsvButton report="profit-and-loss" />
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
            {rowsOf(revenue)}
            <StatementRow label="Total revenue" value={revenue.totalCents} comparison={revenue.comparisonTotalCents} total />

            {cogs.rows.length > 0 && (
              <>
                <StatementSectionHeader label="Cost of sales" />
                {rowsOf(cogs)}
                <StatementRow label="Total cost of sales" value={cogs.totalCents} comparison={cogs.comparisonTotalCents} total />
              </>
            )}
            <StatementRow
              label="Gross profit"
              value={report.grossProfitCents}
              comparison={report.comparisonGrossProfitCents}
              emphasis
            />

            <StatementSectionHeader label="Operating expenses (excluding depreciation & amortization)" />
            {rowsOf(opex)}
            <StatementRow label="Total operating expenses" value={opex.totalCents} comparison={opex.comparisonTotalCents} total />

            {/* The point of the whole restructure: earnings before interest,
                tax, depreciation and amortization, stated rather than implied. */}
            <StatementRow label="EBITDA" value={report.ebitdaCents} comparison={report.comparisonEbitdaCents} emphasis />

            {depreciation.rows.length > 0 && (
              <>
                <StatementSectionHeader label="Depreciation & amortization" />
                {rowsOf(depreciation)}
                <StatementRow
                  label="Total depreciation & amortization"
                  value={depreciation.totalCents}
                  comparison={depreciation.comparisonTotalCents}
                  total
                />
              </>
            )}
            <StatementRow
              label="EBIT — operating income"
              value={report.ebitCents}
              comparison={report.comparisonEbitCents}
              emphasis
            />

            {(otherIncome.rows.length > 0 || otherExpense.rows.length > 0) && (
              <>
                <StatementSectionHeader label="Other income & expenses" />
                {rowsOf(otherIncome)}
                {rowsOf(otherExpense, true)}
              </>
            )}

            {interest.rows.length > 0 && (
              <>
                <StatementSectionHeader label="Interest expense" />
                {rowsOf(interest, true)}
              </>
            )}

            <StatementRow
              label="Income before tax"
              value={report.incomeBeforeTaxCents}
              comparison={report.comparisonIncomeBeforeTaxCents}
              emphasis
            />

            {incomeTax.rows.length > 0 && (
              <>
                <StatementSectionHeader label="Income tax expense" />
                {rowsOf(incomeTax, true)}
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

        <div className="mt-6 grid gap-3 border-t border-paper-300 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Gross margin" value={percent(report.grossMarginPercent)} />
          <Metric label="EBITDA margin" value={percent(report.ebitdaMarginPercent)} />
          <Metric label="Net margin" value={percent(report.netMarginPercent)} />
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
