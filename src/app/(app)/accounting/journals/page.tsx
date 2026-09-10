import Link from "next/link";
import { listEntries } from "@/server/db/journal-entries";
import { listFiscalPeriods } from "@/server/db/fiscal-periods";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { SOURCE_LABELS } from "@/lib/enums";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today, formatDate } from "@/lib/dates";
import { Badge, Card, EmptyState, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { FilterBar, RangePicker } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Journal entries" };

export default async function JournalsPage({ searchParams }: PageProps<"/accounting/journals">) {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));
  const source = typeof params.source === "string" ? params.source : "";
  const query = typeof params.q === "string" ? params.q : "";

  const q = query.toLowerCase();
  const [allInRange, periods] = await Promise.all([
    listEntries(company.id, { from, to }),
    listFiscalPeriods(company.id),
  ]);
  const periodById = new Map(periods.map((p) => [p.id, p]));

  const sourceCount = new Map<string, number>();
  for (const e of allInRange) sourceCount.set(e.sourceType, (sourceCount.get(e.sourceType) ?? 0) + 1);
  const countOf = (type: string) => sourceCount.get(type) ?? 0;

  const entries = allInRange
    .filter((e) => !source || e.sourceType === source)
    .filter(
      (e) =>
        !q ||
        e.entryNo.toLowerCase().includes(q) ||
        (e.memo ?? "").toLowerCase().includes(q) ||
        (e.sourceNumber ?? "").toLowerCase().includes(q),
    )
    .slice(0, 200)
    .map((e) => ({
      ...e,
      fiscalPeriod: e.fiscalPeriodId
        ? periodById.get(e.fiscalPeriodId)
          ? { name: periodById.get(e.fiscalPeriodId)!.name, status: periodById.get(e.fiscalPeriodId)!.status }
          : null
        : null,
    }));
  const totalCents = entries.reduce((s, e) => s + e.totalDebitCents, 0);

  return (
    <>
      <PageHeader
        title="Journal entries"
        breadcrumb={[{ label: "Accounting" }, { label: "Journal entries" }]}
        description="Every posting in the ledger, whatever created it. Posted entries are immutable — corrections are made by reversal."
        actions={
          <>
            <ExportCsvButton report="journal-report" />
            <LinkButton href="/accounting/journals/new" variant="primary">
            <Icon name="plus" className="h-3.5 w-3.5" />
              New journal entry
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangePicker from={isoDate(from)} to={isoDate(to)} />
      </div>

      <FilterBar
        paramName="source"
        searchPlaceholder="Search entry number or memo…"
        tabs={[
          { label: "All", value: "" },
          { label: "Invoices", value: "INVOICE", count: countOf("INVOICE") },
          { label: "Bills", value: "BILL", count: countOf("BILL") },
          { label: "Payments", value: "PAYMENT", count: countOf("PAYMENT") },
          { label: "Expenses", value: "EXPENSE", count: countOf("EXPENSE") },
          { label: "Manual", value: "MANUAL", count: countOf("MANUAL") },
          { label: "Adjustments", value: "ADJUSTMENT", count: countOf("ADJUSTMENT") },
        ]}
      />

      <Card className="p-5">
        {entries.length === 0 ? (
          <EmptyState title="No entries in this range" description="Adjust the date range or the source filter." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="6.5rem">Date</Th>
                <Th width="7rem">Entry</Th>
                <Th width="8rem">Source</Th>
                <Th>Memo</Th>
                <Th width="9rem">Period</Th>
                <Th width="9rem" align="right">Amount</Th>
                <Th width="7rem">Status</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="text-muted-ink">{formatDate(entry.date)}</Td>
                  <Td>
                    <Link href={`/accounting/journals/${entry.id}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                      {entry.entryNo}
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-[0.75rem] text-muted-ink">{SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}</span>
                    {entry.sourceNumber && <span className="block text-[0.75rem] text-ink-700">{entry.sourceNumber}</span>}
                  </Td>
                  <Td>
                    {entry.memo}
                    {entry.isAdjusting && <Badge tone="caution" className="ml-1.5">adjusting</Badge>}
                  </Td>
                  <Td>
                    <span className="text-[0.75rem] text-muted-ink">{entry.fiscalPeriod?.name ?? "—"}</span>
                    {entry.fiscalPeriod && entry.fiscalPeriod.status !== "OPEN" && (
                      <Badge className="ml-1.5">{entry.fiscalPeriod.status.toLowerCase()}</Badge>
                    )}
                  </Td>
                  <Td align="right"><Money cents={entry.totalDebitCents} /></Td>
                  <Td><StatusBadge status={entry.status} /></Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={5} className="pt-3 font-medium text-ink-700">
                  {entries.length} entr{entries.length === 1 ? "y" : "ies"}
                </Td>
                <Td align="right" className="pt-3"><Money cents={totalCents} bold /></Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
