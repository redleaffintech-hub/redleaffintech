import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { cashFlow } from "@/server/reports/financials";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { ReconciliationBanner, ReportSheet, StatementRow, StatementSectionHeader, periodLabel } from "@/components/report-shell";

export const metadata = { title: "Cash flow" };

export default async function CashFlowPage({ searchParams }: PageProps<"/reports/cash-flow">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const currency = company.baseCurrency;
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));

  const report = await cashFlow(company.id, { from, to });

  return (
    <>
      <PageHeader
        title="Cash flow"
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Cash flow" }]}
        description="Indirect method. Built from ledger movements, so it always ties to the actual change in bank balances."
      />

      <ReportSheet
        companyName={company.name}
        title="Statement of Cash Flows"
        periodLabel={periodLabel(from, to)}
        basisNote="Indirect method — net income adjusted for non-cash movements and changes in working capital."
        toolbar={
          <>
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
            <PrintButton />
          </>
        }
      >
        <ReconciliationBanner
          reconciled={report.tieOutCents === 0}
          message={
            report.tieOutCents === 0
              ? "Cash flow ties to the movement in bank accounts."
              : `Cash flow does not tie — out by ${formatMoney(Math.abs(report.tieOutCents), { currency })}.`
          }
          detail={`Opening cash ${formatMoney(report.cashOpeningCents, { currency })} + net change ${formatMoney(report.netChangeCents, { currency })} = closing cash ${formatMoney(report.cashClosingCents, { currency })}.`}
        />

        <table className="w-full">
          <tbody>
            <StatementSectionHeader label="Operating activities" colSpan={2} />
            <StatementRow label="Net income for the period" value={report.netIncomeCents} indent={1} href="/reports/profit-and-loss" />
            {report.operatingItems.map((item) => (
              <StatementRow key={item.code} label={changeLabel(item.name)} code={item.code} value={item.amountCents} indent={1} />
            ))}
            <StatementRow label="Net cash from operating activities" value={report.operatingCents} total />

            <StatementSectionHeader label="Investing activities" colSpan={2} />
            {report.investingItems.length === 0 ? (
              <StatementRow label="No investing activity in this period" value={0} indent={1} />
            ) : (
              report.investingItems.map((item) => (
                <StatementRow key={item.code} label={changeLabel(item.name)} code={item.code} value={item.amountCents} indent={1} />
              ))
            )}
            <StatementRow label="Net cash from investing activities" value={report.investingCents} total />

            <StatementSectionHeader label="Financing activities" colSpan={2} />
            {report.financingItems.length === 0 ? (
              <StatementRow label="No financing activity in this period" value={0} indent={1} />
            ) : (
              report.financingItems.map((item) => (
                <StatementRow key={item.code} label={changeLabel(item.name)} code={item.code} value={item.amountCents} indent={1} />
              ))
            )}
            <StatementRow label="Net cash from financing activities" value={report.financingCents} total />

            <StatementRow label="Net change in cash" value={report.netChangeCents} emphasis />
            <StatementRow label="Cash at the beginning of the period" value={report.cashOpeningCents} indent={1} />
            <StatementRow label="Cash at the end of the period" value={report.cashClosingCents} emphasis />
          </tbody>
        </table>

        <p className="mt-6 border-t border-paper-300 pt-4 text-[0.75rem] leading-5 text-muted-ink">
          Each line is the cash effect of the movement in a balance-sheet account: a rise in receivables consumes cash,
          a rise in payables provides it. Because every non-cash account is accounted for, the three sections must sum
          to the real movement in the bank accounts — which is the check shown above.
        </p>
      </ReportSheet>
    </>
  );
}

function changeLabel(name: string): string {
  return `Change in ${name.toLowerCase()}`;
}
