import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { balanceSheet } from "@/server/reports/financials";
import { isoDate, toUtcDay, today, addDays, formatDateLong, fiscalYearOf, fiscalYearRange } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { AsOfPicker } from "../as-of-picker";
import { ReconciliationBanner, ReportSheet, StatementRow, StatementSectionHeader, asOfLabel } from "@/components/report-shell";

export const metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({ searchParams }: PageProps<"/reports/balance-sheet">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const currency = company.baseCurrency;
  const params = await searchParams;

  const asOf = toUtcDay(typeof params.asOf === "string" ? params.asOf : isoDate(today()));
  // Comparative column is the prior fiscal year end — the convention for a
  // balance sheet, and the date a reader expects to compare against.
  const priorYear = fiscalYearRange(fiscalYearOf(asOf, company.fiscalYearStartMonth) - 1, company.fiscalYearStartMonth);
  const comparisonDate = priorYear.end;
  const report = await balanceSheet(company.id, asOf, comparisonDate);

  const find = (key: string) => report.sections.find((s) => s.key === key)!;
  const currentAssets = find("CURRENT_ASSETS");
  const fixedAssets = find("FIXED_ASSETS");
  const currentLiabilities = find("CURRENT_LIABILITIES");
  const longTerm = find("LONG_TERM_LIABILITIES");
  const equity = find("EQUITY");

  const glLink = (accountId: string) => `/accounting/general-ledger?account=${accountId}&to=${isoDate(asOf)}`;

  return (
    <>
      <PageHeader
        title="Balance sheet"
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Balance sheet" }]}
        description="Assets must equal liabilities plus equity. The check below is computed, not asserted."
      />

      <ReportSheet
        companyName={company.name}
        title="Balance Sheet"
        periodLabel={asOfLabel(asOf)}
        toolbar={
          <>
            <AsOfPicker value={isoDate(asOf)} />
            <PrintButton />
            <ExportCsvButton report="balance-sheet" />
          </>
        }
      >
        <ReconciliationBanner
          reconciled={report.outOfBalanceCents === 0}
          message={
            report.outOfBalanceCents === 0
              ? "Balance sheet balances."
              : `Balance sheet is out by ${formatMoney(Math.abs(report.outOfBalanceCents), { currency })}.`
          }
          detail={`Total assets ${formatMoney(report.totalAssetsCents, { currency })} — total liabilities and equity ${formatMoney(report.totalLiabilitiesAndEquityCents, { currency })}.`}
        />

        <table className="w-full">
          <thead>
            <tr className="border-b border-paper-300">
              <th className="pb-2 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Account</th>
              <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                {formatDateLong(asOf)}
              </th>
              <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                {formatDateLong(comparisonDate)}
              </th>
            </tr>
          </thead>
          <tbody>
            <StatementSectionHeader label="Assets" />
            {currentAssets.rows.length > 0 && (
              <>
                {currentAssets.rows.map((row) => (
                  <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
                ))}
                <StatementRow label="Total current assets" value={currentAssets.totalCents} comparison={currentAssets.comparisonTotalCents} total />
              </>
            )}
            {fixedAssets.rows.length > 0 && (
              <>
                {fixedAssets.rows.map((row) => (
                  <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
                ))}
                <StatementRow label="Total property & equipment" value={fixedAssets.totalCents} comparison={fixedAssets.comparisonTotalCents} total />
              </>
            )}
            <StatementRow label="Total assets" value={report.totalAssetsCents} comparison={(currentAssets.comparisonTotalCents ?? 0) + (fixedAssets.comparisonTotalCents ?? 0)} emphasis />

            <StatementSectionHeader label="Liabilities" />
            {currentLiabilities.rows.map((row) => (
              <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
            ))}
            <StatementRow label="Total current liabilities" value={currentLiabilities.totalCents} comparison={currentLiabilities.comparisonTotalCents} total />
            {longTerm.rows.length > 0 && (
              <>
                {longTerm.rows.map((row) => (
                  <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
                ))}
                <StatementRow label="Total long-term liabilities" value={longTerm.totalCents} comparison={longTerm.comparisonTotalCents} total />
              </>
            )}
            <StatementRow label="Total liabilities" value={report.totalLiabilitiesCents} comparison={(currentLiabilities.comparisonTotalCents ?? 0) + (longTerm.comparisonTotalCents ?? 0)} emphasis />

            <StatementSectionHeader label="Equity" />
            {equity.rows.map((row) => (
              <StatementRow key={row.accountId} label={row.name} code={row.code} value={row.balanceCents} comparison={row.comparisonCents} href={glLink(row.accountId)} indent={1} />
            ))}
            <StatementRow
              label="Current earnings (not yet closed)"
              value={report.currentEarningsCents}
              comparison={report.priorEarningsCents}
              href="/reports/profit-and-loss"
              indent={1}
            />
            <StatementRow label="Total equity" value={report.totalEquityCents} comparison={(equity.comparisonTotalCents ?? 0) + report.priorEarningsCents} total />
            <StatementRow label="Total liabilities & equity" value={report.totalLiabilitiesAndEquityCents} emphasis />
          </tbody>
        </table>

        <p className="mt-6 border-t border-paper-300 pt-4 text-[0.75rem] leading-5 text-muted-ink">
          &ldquo;Current earnings&rdquo; is revenue less expenses that has not yet been swept into Retained Earnings by a
          year-end close. Running the year-end close moves this figure into Retained Earnings and resets the income
          statement to zero for the new year.
        </p>
      </ReportSheet>
    </>
  );
}
