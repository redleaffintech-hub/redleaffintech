import Link from "next/link";
import { db } from "@/lib/db";
import { contains } from "@/lib/search";
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

  const [entries, sourceCounts] = await Promise.all([
    db.journalEntry.findMany({
      where: {
        companyId: company.id,
        date: { gte: from, lte: to },
        ...(source ? { sourceType: source } : {}),
        ...(query ? { OR: [{ entryNo: contains(query) }, { memo: contains(query) }, { sourceNumber: contains(query) }] } : {}),
      },
      orderBy: [{ date: "desc" }, { entryNo: "desc" }],
      take: 200,
      include: { fiscalPeriod: { select: { name: true, status: true } } },
    }),
    db.journalEntry.groupBy({
      by: ["sourceType"],
      where: { companyId: company.id, date: { gte: from, lte: to } },
      _count: true,
    }),
  ]);

  const countOf = (type: string) => sourceCounts.find((c) => c.sourceType === type)?._count ?? 0;
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
