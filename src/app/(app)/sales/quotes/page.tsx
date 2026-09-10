import Link from "next/link";
import { estimates as estimatesRepo } from "@/server/db/estimates";
import { getCustomer } from "@/server/db/customers";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, today, daysBetween, dateRangeWhere } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  Callout, Card, EmptyState, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr,
} from "@/components/ui";
import { DateRangeFilter, FilterBar } from "@/components/filter-bar";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Sales quotes" };

export default async function QuotesPage({ searchParams }: PageProps<"/sales/quotes">) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const currency = company.baseCurrency;
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "";
  const query = typeof params.q === "string" ? params.q : "";
  const issuedBetween = dateRangeWhere(params.from, params.to);

  const q = query.toLowerCase();
  const from = issuedBetween?.gte ?? null;
  const to = issuedBetween?.lte ?? null;

  const allQuotes = await estimatesRepo.list(company.id, { orderBy: "issueDate", direction: "desc" });
  const customerNames = new Map<string, string>();
  await Promise.all(
    [...new Set(allQuotes.map((e) => e.customerId))].map(async (id) => {
      customerNames.set(id, (await getCustomer(company.id, id))?.name ?? "—");
    }),
  );

  const statusCount = new Map<string, number>();
  for (const e of allQuotes) statusCount.set(e.status, (statusCount.get(e.status) ?? 0) + 1);
  const countOf = (s: string) => statusCount.get(s) ?? 0;

  const quotes = allQuotes
    .filter((e) => !status || e.status === status)
    .filter(
      (e) =>
        !q ||
        e.number.toLowerCase().includes(q) ||
        (customerNames.get(e.customerId) ?? "").toLowerCase().includes(q),
    )
    .filter((e) => (!from || e.issueDate >= from) && (!to || e.issueDate <= to))
    .slice(0, 150)
    .map((e) => ({ ...e, customer: { id: e.customerId, name: customerNames.get(e.customerId) ?? "—" } }));

  const pipelineCents = quotes
    .filter((quote) => ["SENT", "ACCEPTED"].includes(quote.status))
    .reduce((sum, quote) => sum + quote.totalCents, 0);

  return (
    <>
      <PageHeader
        title="Sales quotes"
        breadcrumb={[{ label: "Sales", href: "/sales/invoices" }, { label: "Sales quotes" }]}
        description={`${formatMoney(pipelineCents, { currency })} of quoted work outstanding. A quote posts nothing to the ledger — only converting it to an invoice does.`}
        actions={
          <LinkButton href="/sales/quotes/new" variant="primary">
            <Icon name="plus" className="h-3.5 w-3.5" />
            New quote
          </LinkButton>
        }
      />

      <div className="mb-4">
        <Callout tone="info" title="Quotes are not accounting documents">
          A quote changes no account balance and appears in no financial statement. It becomes real when you convert it
          to an invoice, at which point the revenue and the tax are recognised.
        </Callout>
      </div>

      <FilterBar
        searchPlaceholder="Search number or customer…"
        tabs={[
          { label: "All", value: "" },
          { label: "Draft", value: "DRAFT", count: countOf("DRAFT") },
          { label: "Sent", value: "SENT", count: countOf("SENT") },
          { label: "Accepted", value: "ACCEPTED", count: countOf("ACCEPTED") },
          { label: "Converted", value: "CONVERTED", count: countOf("CONVERTED") },
          { label: "Declined", value: "DECLINED", count: countOf("DECLINED") },
        ]}
        extra={<DateRangeFilter label="Quote date" />}
      />

      <Card className="p-5">
        {quotes.length === 0 ? (
          <EmptyState
            title="No sales quotes match"
            description={
              query || status || issuedBetween
                ? "Try clearing the filters or widening the date range."
                : "Quote a customer before the work starts, then convert the accepted quote into an invoice."
            }
            action={
              <LinkButton href="/sales/quotes/new" variant="primary">
                New quote
              </LinkButton>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="7rem">Number</Th>
                <Th>Customer</Th>
                <Th width="7rem">Issued</Th>
                <Th width="9rem">Valid until</Th>
                <Th width="5rem" align="right">Lines</Th>
                <Th width="9rem" align="right">Total</Th>
                <Th width="7rem">Status</Th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => {
                const daysLeft = quote.expiryDate ? daysBetween(today(), quote.expiryDate) : null;
                return (
                  <Tr key={quote.id}>
                    <Td className="tnum font-medium text-ink-900">{quote.number}</Td>
                    <Td>
                      <Link
                        href={`/sales/customers/${quote.customer.id}`}
                        className="hover:text-brand-700 hover:underline"
                      >
                        {quote.customer.name}
                      </Link>
                      {quote.memo && <span className="block truncate text-[0.75rem] text-muted-ink">{quote.memo}</span>}
                    </Td>
                    <Td className="text-muted-ink">{formatDate(quote.issueDate)}</Td>
                    <Td className="text-muted-ink">
                      {quote.expiryDate ? formatDate(quote.expiryDate) : "—"}
                      {daysLeft !== null && daysLeft >= 0 && quote.status === "SENT" && (
                        <span className="ml-1.5 text-[0.75rem] text-caution">{daysLeft}d left</span>
                      )}
                    </Td>
                    <Td align="right" className="tnum text-muted-ink">{quote.lines.length}</Td>
                    <Td align="right"><Money cents={quote.totalCents} bold /></Td>
                    <Td><StatusBadge status={quote.status} /></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
