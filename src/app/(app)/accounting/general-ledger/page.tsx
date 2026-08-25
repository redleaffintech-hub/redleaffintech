import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { generalLedger } from "@/server/reports/financials";
import { SOURCE_LABELS } from "@/lib/enums";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today, formatDate } from "@/lib/dates";
import { LinkButton, Money, PageHeader, EmptyState } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { AccountPicker } from "./account-picker";
import { ReportSheet, periodLabel } from "@/components/report-shell";

export const metadata = { title: "General ledger" };

const SOURCE_HREF: Record<string, string> = {
  INVOICE: "/sales/invoices",
  BILL: "/purchases/bills",
  EXPENSE: "/expenses",
  CREDIT_NOTE: "/sales/credit-notes",
};

export default async function GeneralLedgerPage({ searchParams }: PageProps<"/accounting/general-ledger">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));
  const accountId = typeof params.account === "string" ? params.account : "";

  const accounts = await db.account.findMany({
    where: { companyId: company.id },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });

  const groups = await generalLedger(company.id, { from, to }, { accountIds: accountId ? [accountId] : undefined });

  return (
    <>
      <PageHeader
        title="General ledger"
        breadcrumb={[{ label: "Accounting" }, { label: "General ledger" }]}
        description="Every posting against an account, in date order, with a running balance. Each row links to the document that created it."
        actions={<LinkButton href="/accounting/chart-of-accounts/opening-balances">Opening balances</LinkButton>}
      />

      <ReportSheet
        companyName={company.name}
        title="General Ledger"
        periodLabel={periodLabel(from, to)}
        toolbar={
          <>
            <AccountPicker accounts={accounts} value={accountId} />
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
            <PrintButton />
            <ExportCsvButton report="general-ledger" />
          </>
        }
      >
        {groups.length === 0 ? (
          <EmptyState title="No postings in this range" description="Widen the date range or choose a different account." />
        ) : (
          <div className="space-y-8">
            {groups.map((group) => (
              <section key={group.account.id}>
                <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-paper-300 pb-1.5">
                  <h3 className="text-[0.9375rem] font-semibold text-ink-950">
                    <span className="tnum mr-2 text-muted-ink">{group.account.code}</span>
                    {group.account.name}
                  </h3>
                  <span className="text-[0.75rem] text-muted-ink">
                    Opening <Money cents={group.openingBalanceCents} /> · closing{" "}
                    <Money cents={group.closingBalanceCents} className="font-medium text-ink-800" />
                  </span>
                </header>

                <div className="thin-scroll overflow-x-auto">
                  <table className="w-full min-w-[48rem] text-[0.8125rem]">
                    <thead>
                      <tr className="border-b border-paper-200">
                        {["Date", "Entry", "Source", "Description", "Debit", "Credit", "Balance"].map((label, index) => (
                          <th
                            key={label}
                            className={`pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink ${
                              index >= 4 ? "pl-4 text-right" : "pr-4 text-left"
                            }`}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-paper-200 bg-paper-100">
                        <td colSpan={6} className="py-1.5 pr-4 text-[0.75rem] font-medium text-muted-ink">
                          Opening balance
                        </td>
                        <td className="py-1.5 pl-4 text-right"><Money cents={group.openingBalanceCents} /></td>
                      </tr>
                      {group.rows.map((row) => {
                        const href = row.journalEntry.sourceType && SOURCE_HREF[row.journalEntry.sourceType];
                        return (
                          <tr key={row.id} className="border-b border-paper-100 hover:bg-paper-100">
                            <td className="py-2 pr-4 text-muted-ink">{formatDate(row.date)}</td>
                            <td className="py-2 pr-4">
                              <Link href={`/accounting/journals/${row.journalEntryId}`} className="tnum text-ink-800 hover:text-brand-700 hover:underline">
                                {row.journalEntry.entryNo}
                              </Link>
                            </td>
                            <td className="py-2 pr-4">
                              <span className="text-[0.75rem] text-muted-ink">
                                {SOURCE_LABELS[row.journalEntry.sourceType] ?? row.journalEntry.sourceType}
                              </span>
                              {row.journalEntry.sourceNumber && href && (
                                <Link href={`${href}/${row.journalEntry.sourceNumber}`} className="ml-1 text-[0.75rem] text-brand-700 hover:underline">
                                  {row.journalEntry.sourceNumber}
                                </Link>
                              )}
                              {row.journalEntry.sourceNumber && !href && (
                                <span className="ml-1 text-[0.75rem] text-ink-700">{row.journalEntry.sourceNumber}</span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-ink-800">
                              {row.description ?? row.journalEntry.memo}
                              {(row.customer || row.vendor) && (
                                <span className="ml-1.5 text-[0.75rem] text-muted-ink">
                                  · {row.customer?.name ?? row.vendor?.name}
                                </span>
                              )}
                              {row.journalEntry.status === "REVERSED" && (
                                <span className="ml-1.5 text-[0.6875rem] uppercase text-muted-ink">reversed</span>
                              )}
                            </td>
                            <td className="py-2 pl-4 text-right"><Money cents={row.debitCents} blankZero /></td>
                            <td className="py-2 pl-4 text-right"><Money cents={row.creditCents} blankZero /></td>
                            <td className="py-2 pl-4 text-right"><Money cents={row.runningBalanceCents} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-paper-400">
                        <td colSpan={4} className="py-2 pr-4 font-medium text-ink-800">
                          {group.rows.length} posting{group.rows.length === 1 ? "" : "s"}
                        </td>
                        <td className="py-2 pl-4 text-right"><Money cents={group.totalDebitCents} bold /></td>
                        <td className="py-2 pl-4 text-right"><Money cents={group.totalCreditCents} bold /></td>
                        <td className="py-2 pl-4 text-right"><Money cents={group.closingBalanceCents} bold /></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </ReportSheet>
    </>
  );
}
