import Link from "next/link";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { arAging, apAging, bucketLabels, DEFAULT_BUCKETS } from "@/server/reports/aging";
import { isoDate, toUtcDay, today, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Money, PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/filter-bar";
import { AsOfPicker } from "../as-of-picker";
import { AgingBar } from "@/components/charts";
import { ReconciliationBanner, ReportSheet, asOfLabel } from "@/components/report-shell";

export const metadata = { title: "A/R aging" };

export default async function ArAgingPage({ searchParams }: PageProps<"/reports/ar-aging">) {
  return AgingReport({ searchParams, kind: "AR" });
}

/** Shared by /reports/ar-aging and /reports/ap-aging. */
export async function AgingReport({
  searchParams,
  kind,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  kind: "AR" | "AP";
}) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const params = await searchParams;
  const asOf = toUtcDay(typeof params.asOf === "string" ? params.asOf : isoDate(today()));

  const report = kind === "AR" ? await arAging(company.id, asOf) : await apAging(company.id, asOf);
  const labels = bucketLabels(DEFAULT_BUCKETS);
  const isAr = kind === "AR";
  const partyHref = isAr ? "/sales/customers" : "/purchases/vendors";
  const documentHref = isAr ? "/sales/invoices" : "/purchases/bills";

  const chartBuckets = [
    { label: labels[0], value: report.totals.currentCents },
    ...report.totals.buckets.map((value, index) => ({ label: labels[index + 1], value })),
  ];

  return (
    <>
      <PageHeader
        title={isAr ? "Accounts receivable aging" : "Accounts payable aging"}
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: isAr ? "A/R aging" : "A/P aging" }]}
        description={
          isAr
            ? "Outstanding customer balances by age, including unapplied receipts and open credit notes."
            : "Outstanding vendor balances by age, including open vendor credits."
        }
      />

      <ReportSheet
        companyName={company.name}
        title={isAr ? "Accounts Receivable Aging" : "Accounts Payable Aging"}
        periodLabel={asOfLabel(asOf)}
        basisNote={`Balances computed as at the report date from the ${isAr ? "sales" : "purchases"} subledger.`}
        toolbar={
          <>
            <AsOfPicker value={isoDate(asOf)} />
            <PrintButton />
          </>
        }
      >
        <ReconciliationBanner
          reconciled={report.reconciliation.reconciled}
          message={
            report.reconciliation.reconciled
              ? `Subledger reconciles to the ${isAr ? "A/R" : "A/P"} control account.`
              : `Subledger differs from the control account by ${formatMoney(Math.abs(report.reconciliation.differenceCents))}.`
          }
          detail={`Subledger ${formatMoney(report.reconciliation.subledgerTotalCents)} vs general ledger ${formatMoney(report.reconciliation.controlAccountCents)}.`}
        />

        <div className="no-print mb-6 rounded-lg border border-paper-300 p-4">
          <AgingBar buckets={chartBuckets} total={report.totals.totalCents} />
        </div>

        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[54rem] text-[0.8125rem]">
            <thead>
              <tr className="border-b border-paper-300">
                <th className="pb-2 pr-4 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                  {isAr ? "Customer" : "Vendor"}
                </th>
                {labels.map((label) => (
                  <th key={label} className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                    {label}
                  </th>
                ))}
                <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Total</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={labels.length + 2} className="py-10 text-center text-muted-ink">
                    Nothing outstanding as at {formatDate(asOf)}.
                  </td>
                </tr>
              )}
              {report.rows.map((row) => (
                <tr key={row.partyId} className="border-b border-paper-200 align-top">
                  <td className="py-2.5 pr-4">
                    <Link href={`${partyHref}/${row.partyId}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                      {row.partyName}
                    </Link>
                    <details className="mt-1">
                      <summary className="cursor-pointer list-none text-[0.75rem] text-muted-ink hover:text-ink-700">
                        {row.documents.length} document{row.documents.length === 1 ? "" : "s"} ▾
                      </summary>
                      <ul className="mt-1.5 space-y-1 border-l border-paper-300 pl-2.5">
                        {row.documents.map((doc) => (
                          <li key={doc.id} className="flex items-center gap-2 text-[0.75rem]">
                            <Link href={`${documentHref}/${doc.id}`} className="tnum text-ink-700 hover:text-brand-700 hover:underline">
                              {doc.number}
                            </Link>
                            <span className="text-muted-ink">{formatDate(doc.dueDate)}</span>
                            {doc.daysOverdue > 0 && <span className="text-negative">{doc.daysOverdue}d</span>}
                            {doc.status === "CREDIT" && <StatusBadge status="CREDIT" />}
                            <Money cents={doc.balanceCents} className="ml-auto" />
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                  <td className="py-2.5 pl-4 text-right"><Money cents={row.currentCents} blankZero /></td>
                  {row.buckets.map((value, index) => (
                    <td key={index} className="py-2.5 pl-4 text-right">
                      <Money cents={value} blankZero className={value > 0 && index >= 2 ? "text-negative" : undefined} />
                    </td>
                  ))}
                  <td className="py-2.5 pl-4 text-right"><Money cents={row.totalCents} bold /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900">
                <td className="py-2.5 pr-4 font-semibold text-ink-950">Total</td>
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totals.currentCents} bold /></td>
                {report.totals.buckets.map((value, index) => (
                  <td key={index} className="py-2.5 pl-4 text-right"><Money cents={value} bold /></td>
                ))}
                <td className="py-2.5 pl-4 text-right"><Money cents={report.totals.totalCents} bold /></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="mt-5 text-[0.75rem] leading-5 text-muted-ink">
          Aging buckets are measured from each document&rsquo;s due date, not its issue date. Expand a row to see the
          individual documents and open any of them.
        </p>
      </ReportSheet>
    </>
  );
}
