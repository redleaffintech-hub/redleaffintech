import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { incomeStatement, type ReportPeriod } from "@/server/reports/financials";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ReportSheet, periodLabel } from "@/components/report-shell";
import { IncomeStatementTable } from "./statement-table";

export const metadata = { title: "Profit & loss — Income statement" };

export default async function ProfitAndLossPage({ searchParams }: PageProps<"/reports/profit-and-loss">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));

  const periods: ReportPeriod[] = [{ label: "Selected period", from, to }];
  const statement = await incomeStatement(company.id, periods, company.baseCurrency);

  const percent = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);
  const last = statement.periods.length - 1;

  return (
    <>
      <PageHeader
        title="Profit & loss — Income statement"
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Income statement" }]}
        description="Earnings stepped down from net sales to net income. Expand a category to see its accounts, or click one to open its general ledger."
      />

      <ReportSheet
        companyName={company.name}
        title="Income Statement"
        periodLabel={periodLabel(from, to)}
        toolbar={
          <>
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
            <PrintButton />
            <ExportCsvButton report="income-statement" />
          </>
        }
      >
        <IncomeStatementTable statement={statement} ledgerFrom={isoDate(from)} ledgerTo={isoDate(to)} />

        <div className="mt-6 grid gap-3 border-t border-paper-300 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Gross margin" value={percent(statement.margins.GROSS[last])} />
          <Metric label="EBITDA margin" value={percent(statement.margins.EBITDA[last])} />
          <Metric label="EBIT margin" value={percent(statement.margins.EBIT[last])} />
          <Metric label="Net margin" value={percent(statement.margins.NET[last])} />
        </div>
        <p className="mt-2 text-[0.6875rem] text-muted-ink">
          Margins are for the selected period, against net sales. Amounts in {company.baseCurrency}; costs shown in parentheses.
        </p>
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
