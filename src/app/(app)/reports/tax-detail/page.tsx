import Link from "next/link";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { taxDetail } from "@/server/reports/tax-fs";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today, formatDate } from "@/lib/dates";
import { formatRate } from "@/lib/money";
import { Badge, Money, PageHeader } from "@/components/ui";
import { FilterBar, RangePicker, PrintButton } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { ReportSheet, periodLabel } from "@/components/report-shell";

export const metadata = { title: "Tax detail" };

const SOURCE_HREF: Record<string, string> = {
  INVOICE: "/sales/invoices",
  BILL: "/purchases/bills",
  EXPENSE: "/expenses",
  CREDIT_NOTE: "/sales/credit-notes",
};

export default async function TaxDetailPage({ searchParams }: PageProps<"/reports/tax-detail">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));
  const direction = typeof params.direction === "string" ? params.direction : "";

  const entries = await taxDetail(company.id, { from, to }, {
    direction: direction === "SALE" || direction === "PURCHASE" ? direction : undefined,
  });

  return (
    <>
      <PageHeader
        title="Tax detail"
        breadcrumb={[{ label: "Reports", href: "/reports" }, { label: "Tax detail" }]}
        description="Every taxable line, with the rate that was in force when it posted. Historical transactions are never re-rated."
      />

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <FilterBar
          paramName="direction"
          tabs={[
            { label: "All", value: "" },
            { label: "Sales", value: "SALE" },
            { label: "Purchases", value: "PURCHASE" },
          ]}
        />
      </div>

      <ReportSheet
        companyName={company.name}
        title="Sales Tax Detail"
        periodLabel={periodLabel(from, to)}
        basisNote="One row per tax component per source line."
        toolbar={
          <>
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
            <PrintButton />
            <ExportCsvButton report="tax-detail" />
          </>
        }
      >
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[54rem] text-[0.8125rem]">
            <thead>
              <tr className="border-b border-paper-300">
                {["Date", "Source", "Party", "Code", "Rate", "Taxable", "Tax", "Recoverable"].map((label, index) => (
                  <th
                    key={label}
                    className={`pb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink ${
                      index >= 4 ? "pl-4 text-right" : "pr-4 text-left"
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted-ink">No taxable transactions in this period.</td>
                </tr>
              )}
              {entries.map((entry) => {
                const href = SOURCE_HREF[entry.sourceType];
                return (
                  <tr key={entry.id} className="border-b border-paper-200 hover:bg-paper-100">
                    <td className="py-2 pr-4 text-muted-ink">{formatDate(entry.date)}</td>
                    <td className="py-2 pr-4">
                      {href ? (
                        <Link href={`${href}/${entry.sourceId}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                          {entry.sourceNumber ?? entry.sourceType}
                        </Link>
                      ) : (
                        <span className="tnum text-ink-800">{entry.sourceNumber ?? entry.sourceType}</span>
                      )}
                      <span className="block text-[0.6875rem] uppercase tracking-[0.04em] text-muted-ink">
                        {entry.direction === "SALE" ? "Sale" : "Purchase"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-ink-800">{entry.partyName ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <Badge tone="info">{entry.kind}</Badge>
                      <span className="ml-1.5 text-[0.75rem] text-muted-ink">{entry.taxCode.code}</span>
                    </td>
                    <td className="tnum py-2 pl-4 text-right text-muted-ink">{formatRate(entry.rateMicro)}</td>
                    <td className="py-2 pl-4 text-right"><Money cents={entry.taxableCents} /></td>
                    <td className="py-2 pl-4 text-right"><Money cents={entry.taxCents} bold /></td>
                    <td className="py-2 pl-4 text-right"><Money cents={entry.recoverableCents} blankZero /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-900">
                <td colSpan={5} className="py-2.5 pr-4 font-semibold text-ink-950">
                  {entries.length} row{entries.length === 1 ? "" : "s"}
                </td>
                <td className="py-2.5 pl-4 text-right"><Money cents={entries.reduce((s, e) => s + e.taxableCents, 0)} bold /></td>
                <td className="py-2.5 pl-4 text-right"><Money cents={entries.reduce((s, e) => s + e.taxCents, 0)} bold /></td>
                <td className="py-2.5 pl-4 text-right"><Money cents={entries.reduce((s, e) => s + e.recoverableCents, 0)} bold /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </ReportSheet>
    </>
  );
}
