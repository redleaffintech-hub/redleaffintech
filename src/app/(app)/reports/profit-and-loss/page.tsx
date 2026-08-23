import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { incomeStatement, type ReportPeriod } from "@/server/reports/financials";
import { fiscalYearOf, fiscalYearRange, isoDate, today } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ReportSheet, periodLabel } from "@/components/report-shell";
import { PeriodPicker } from "./period-picker";
import { IncomeStatementTable } from "./statement-table";

export const metadata = { title: "Profit & loss — Income statement" };

/** Up to four columns: more stops fitting on a printed page. */
const MAX_PERIODS = 4;

/**
 * Column heading for a fiscal period, in the company's locale.
 *
 * A fiscal year is named for the month it ENDS in — "Dec-25" is the year ending
 * December 2025 — which is what makes the columns readable for a company whose
 * year does not end in December.
 */
function columnLabel(end: Date, locale: string): string {
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(end);
  return `${month}-${String(end.getUTCFullYear()).slice(2)}`;
}

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const params = await searchParams;

  const currentFy = fiscalYearOf(today(), company.fiscalYearStartMonth);
  const requestedEnd = Number(typeof params.end === "string" ? params.end : "");
  const endYear = Number.isInteger(requestedEnd) && requestedEnd > 1900 && requestedEnd < 2200 ? requestedEnd : currentFy;

  const requestedCount = Number(typeof params.periods === "string" ? params.periods : "");
  const count = Number.isInteger(requestedCount) && requestedCount >= 1 && requestedCount <= MAX_PERIODS
    ? requestedCount
    : Math.min(MAX_PERIODS, 4);

  // Oldest first, so the columns read left to right like the printed statement.
  const periods: ReportPeriod[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const year = endYear - offset;
    const range = fiscalYearRange(year, company.fiscalYearStartMonth);
    // The current year is only complete up to today; a column running to a
    // future date would present an empty stub as a real period.
    const to = year === currentFy && range.end > today() ? today() : range.end;
    periods.push({ label: columnLabel(range.end, company.locale || "en-CA"), from: range.start, to });
  }

  const statement = await incomeStatement(company.id, periods, company.baseCurrency);

  const latest = periods[periods.length - 1];

  const availableYears: number[] = [];
  for (let y = currentFy + 1; y >= currentFy - 8; y--) availableYears.push(y);

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
        periodLabel={periodLabel(periods[0].from, latest.to)}
        toolbar={
          <>
            <PeriodPicker endYear={endYear} count={count} availableYears={availableYears} />
            <PrintButton />
            <ExportCsvButton report="income-statement" />
          </>
        }
      >
        <IncomeStatementTable
          statement={statement}
          ledgerFrom={isoDate(latest.from)}
          ledgerTo={isoDate(latest.to)}
        />

        <div className="mt-6 grid gap-3 border-t border-paper-300 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Gross margin" value={percent(statement.margins.GROSS[last])} />
          <Metric label="EBITDA margin" value={percent(statement.margins.EBITDA[last])} />
          <Metric label="EBIT margin" value={percent(statement.margins.EBIT[last])} />
          <Metric label="Net margin" value={percent(statement.margins.NET[last])} />
        </div>
        <p className="mt-2 text-[0.6875rem] text-muted-ink">
          Margins are for {latest.label}, against net sales. Amounts in {company.baseCurrency}; costs shown in parentheses.
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
