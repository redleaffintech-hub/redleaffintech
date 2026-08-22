import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { trialBalance } from "@/server/reports/financials";
import { NORMAL_BALANCE, type AccountType } from "@/lib/enums";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Money, PageHeader } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { ReconciliationBanner, ReportSheet, periodLabel } from "@/components/report-shell";
import Link from "next/link";

export const metadata = { title: "Trial balance" };

export default async function TrialBalancePage({ searchParams }: PageProps<"/accounting/trial-balance">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const currency = company.baseCurrency;
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));

  const report = await trialBalance(company.id, { from, to });

  return (
    <>
      <PageHeader
        title="Trial balance"
        breadcrumb={[{ label: "Accounting" }, { label: "Trial balance" }]}
        description="Opening balance, movement in the period and closing balance for every account that has activity."
      />

      <ReportSheet
        companyName={company.name}
        title="Trial Balance"
        periodLabel={periodLabel(from, to)}
        toolbar={
          <>
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
            <PrintButton />
          </>
        }
      >
        <ReconciliationBanner
          reconciled={report.balanced}
          message={report.balanced ? "Debits equal credits." : "Trial balance does not balance."}
          detail={`Period movement ${formatMoney(report.totalDebitCents, { currency })} Dr / ${formatMoney(report.totalCreditCents, { currency })} Cr. Closing ${formatMoney(report.closingDebitCents, { currency })} Dr / ${formatMoney(report.closingCreditCents, { currency })} Cr.`}
        />

        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[50rem] text-[0.8125rem]">
            <thead>
              <tr className="border-b border-paper-300">
                <th className="pb-2 pr-4 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Account</th>
                <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Opening</th>
                <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Debit</th>
                <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Credit</th>
                <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Closing</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.accountId} className="border-b border-paper-200 hover:bg-paper-100">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/accounting/general-ledger?account=${row.accountId}&from=${isoDate(from)}&to=${isoDate(to)}`}
                      className="hover:text-brand-700 hover:underline"
                    >
                      <span className="tnum mr-2 text-[0.75rem] text-muted-ink">{row.code}</span>
                      <span className="text-ink-800">{row.name}</span>
                    </Link>
                    <span className="ml-2 text-[0.6875rem] uppercase tracking-[0.04em] text-muted-ink">
                      {NORMAL_BALANCE[row.type as AccountType] === "DEBIT" ? "Dr" : "Cr"}
                    </span>
                  </td>
                  <td className="py-2 pl-4 text-right"><Money cents={row.openingCents} blankZero /></td>
                  <td className="py-2 pl-4 text-right"><Money cents={row.periodDebitCents} blankZero /></td>
                  <td className="py-2 pl-4 text-right"><Money cents={row.periodCreditCents} blankZero /></td>
                  <td className="py-2 pl-4 text-right"><Money cents={row.closingCents} bold blankZero /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900">
                <td className="py-2.5 pr-4 font-semibold text-ink-950">
                  Total — {report.rows.length} account{report.rows.length === 1 ? "" : "s"}
                </td>
                <td />
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totalDebitCents} bold /></td>
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totalCreditCents} bold /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </ReportSheet>
    </>
  );
}
