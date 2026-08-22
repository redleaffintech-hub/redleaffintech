import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { taxSummary } from "@/server/reports/tax";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge, LinkButton, Money, PageHeader } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { ReconciliationBanner, ReportSheet, periodLabel } from "@/components/report-shell";

export const metadata = { title: "Tax summary" };

export default async function TaxSummaryPage({ searchParams }: PageProps<"/reports/tax-summary">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const currency = company.baseCurrency;
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));

  const report = await taxSummary(company.id, { from, to });

  return (
    <>
      <PageHeader
        title="Tax summary"
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Tax summary" }]}
        description="Tax collected on sales and input tax credits claimed on purchases, by code and jurisdiction."
        actions={<LinkButton href="/reports/tax-detail">Transaction detail</LinkButton>}
      />

      <ReportSheet
        companyName={company.name}
        title="Sales Tax Summary"
        periodLabel={periodLabel(from, to)}
        basisNote="Each row is built from the tax entries written when the source document was posted, at the rate in force on that date."
        toolbar={
          <>
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
            <PrintButton />
          </>
        }
      >
        <ReconciliationBanner
          reconciled={report.reconciliation.reconciled}
          message={
            report.reconciliation.reconciled
              ? "Tax subledger reconciles to the tax control accounts."
              : "Tax subledger does not match the tax control accounts."
          }
          detail={`Collected: subledger ${formatMoney(report.reconciliation.subledgerCollected, { currency })} vs GL ${formatMoney(report.reconciliation.glCollected, { currency })}. ITCs: subledger ${formatMoney(report.reconciliation.subledgerRecoverable, { currency })} vs GL ${formatMoney(report.reconciliation.glRecoverable, { currency })}.`}
        />

        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[52rem] text-[0.8125rem]">
            <thead>
              <tr className="border-b border-paper-300">
                <Th>Tax code</Th>
                <Th>Type</Th>
                <Th align="right">Taxable sales</Th>
                <Th align="right">Tax collected</Th>
                <Th align="right">Taxable purchases</Th>
                <Th align="right">Tax paid</Th>
                <Th align="right">Recoverable (ITC)</Th>
                <Th align="right">Net</Th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted-ink">No taxable activity in this period.</td>
                </tr>
              )}
              {report.rows.map((row) => (
                <tr key={`${row.kind}-${row.taxCode}`} className="border-b border-paper-200 hover:bg-paper-100">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium text-ink-900">{row.taxCode}</span>
                    <span className="block text-[0.75rem] text-muted-ink">{row.taxCodeName}</span>
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge tone="info">{row.kind}</Badge>
                    <span className="ml-1.5 text-[0.75rem] text-muted-ink">{row.jurisdiction}</span>
                  </td>
                  <td className="py-2.5 pl-4 text-right"><Money cents={row.salesTaxableCents} blankZero /></td>
                  <td className="py-2.5 pl-4 text-right"><Money cents={row.taxCollectedCents} blankZero /></td>
                  <td className="py-2.5 pl-4 text-right"><Money cents={row.purchaseTaxableCents} blankZero /></td>
                  <td className="py-2.5 pl-4 text-right"><Money cents={row.taxPaidCents} blankZero /></td>
                  <td className="py-2.5 pl-4 text-right"><Money cents={row.recoverableCents} blankZero /></td>
                  <td className="py-2.5 pl-4 text-right"><Money cents={row.netCents} bold /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900">
                <td colSpan={2} className="py-2.5 pr-4 font-semibold text-ink-950">Total</td>
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totals.salesTaxableCents} bold /></td>
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totals.taxCollectedCents} bold /></td>
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totals.purchaseTaxableCents} bold /></td>
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totals.taxPaidCents} bold /></td>
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totals.recoverableCents} bold /></td>
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totals.netCents} bold /></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-6 grid gap-4 border-t border-paper-300 pt-5 sm:grid-cols-2">
          <div className="rounded-lg bg-paper-100 p-4">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
              Net tax {report.totals.netCents >= 0 ? "payable" : "refundable"}
            </p>
            <p className="tnum mt-1 text-[1.5rem] font-semibold text-ink-950">
              {formatMoney(Math.abs(report.totals.netCents), { currency })}
            </p>
            <p className="mt-1 text-[0.75rem] text-muted-ink">
              Tax collected {formatMoney(report.totals.taxCollectedCents, { currency })} less input tax credits{" "}
              {formatMoney(report.totals.recoverableCents, { currency })}.
            </p>
          </div>
          <div className="rounded-lg border border-paper-300 p-4">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Control accounts</p>
            <ul className="mt-2 space-y-1 text-[0.8125rem]">
              {report.reconciliation.accounts.map((account) => (
                <li key={account.id} className="flex items-center gap-2">
                  <span className="tnum text-[0.75rem] text-muted-ink">{account.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-700">{account.name}</span>
                  <Money cents={account.movementCents} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-5 text-[0.75rem] leading-5 text-muted-ink">
          Provincial sales tax (PST/RST) is generally not recoverable by the purchaser, so it is absorbed into the
          expense rather than claimed — which is why &ldquo;Tax paid&rdquo; and &ldquo;Recoverable&rdquo; differ. Have a
          CPA confirm the treatment for your registrations before filing.
        </p>
      </ReportSheet>
    </>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`pb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink ${
        align === "right" ? "pl-4 text-right" : "pr-4 text-left"
      }`}
    >
      {children}
    </th>
  );
}
