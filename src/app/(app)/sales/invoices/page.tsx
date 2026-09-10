import Link from "next/link";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { getCustomer } from "@/server/db/customers";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, today, daysBetween } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  Card, EmptyState, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr,
} from "@/components/ui";
import { DateRangeFilter, FilterBar } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: PageProps<"/sales/invoices">) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const currency = company.baseCurrency;
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "";
  const query = typeof params.q === "string" ? params.q : "";
  // The range narrows by invoice date — the date the revenue was recognised.
  const asOfNow = today();

  /**
   * "Overdue" is a fact about the due date, not a stored flag — deriving it
   * keeps the list honest without a nightly job having to have run.
   */
  const from =
    typeof params.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.from)
      ? new Date(`${params.from}T00:00:00.000Z`)
      : null;
  const to =
    typeof params.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.to)
      ? new Date(`${params.to}T23:59:59.999Z`)
      : null;
  const issuedBetween = Boolean(from || to);

  const q = query.toLowerCase();
  const OPEN = ["SENT", "PARTIALLY_PAID", "OVERDUE"];
  const everyInvoice = await invoicesRepo.list(company.id, { orderBy: "issueDate", direction: "desc" });
  const customerNames = new Map<string, string>();
  await Promise.all(
    [...new Set(everyInvoice.map((i) => i.customerId))].map(async (id) => {
      customerNames.set(id, (await getCustomer(company.id, id))?.name ?? "—");
    }),
  );

  const isOverdue = (i: (typeof everyInvoice)[number]) =>
    OPEN.includes(i.status) && i.balanceCents > 0 && i.dueDate < asOfNow;

  const invoices = everyInvoice
    .filter((i) => {
      if (status === "OPEN") return OPEN.includes(i.status);
      if (status === "OVERDUE") return isOverdue(i);
      if (status) return i.status === status;
      return true;
    })
    .filter(
      (i) =>
        !q ||
        i.number.toLowerCase().includes(q) ||
        (customerNames.get(i.customerId) ?? "").toLowerCase().includes(q),
    )
    .filter((i) => (!from || i.issueDate >= from) && (!to || i.issueDate <= to))
    .slice(0, 150)
    .map((i) => ({ ...i, customer: { id: i.customerId, name: customerNames.get(i.customerId) ?? "—" } }));

  const statusCount = new Map<string, number>();
  for (const i of everyInvoice) statusCount.set(i.status, (statusCount.get(i.status) ?? 0) + 1);
  const overdueCount = everyInvoice.filter(isOverdue).length;
  const outstandingCents = everyInvoice
    .filter((i) => OPEN.includes(i.status))
    .reduce((sum, i) => sum + i.balanceCents, 0);

  const countOf = (statuses: string[]) =>
    statuses.reduce((sum, st) => sum + (statusCount.get(st) ?? 0), 0);

  const asOf = asOfNow;

  return (
    <>
      <PageHeader
        title="Invoices"
        description={
          outstandingCents > 0
            ? `${formatMoney(outstandingCents, { currency })} outstanding across ${countOf(["SENT", "PARTIALLY_PAID", "OVERDUE"])} open invoices.`
            : "Every invoice is settled."
        }
        actions={
          <>
            <ExportCsvButton report="invoices" />
            <LinkButton href="/reports/ar-aging">A/R aging</LinkButton>
            <LinkButton href="/sales/invoices/new" variant="primary">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New invoice
            </LinkButton>
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Search number or customer…"
        tabs={[
          { label: "All", value: "" },
          { label: "Open", value: "OPEN", count: countOf(["SENT", "PARTIALLY_PAID", "OVERDUE"]) },
          { label: "Overdue", value: "OVERDUE", count: overdueCount },
          { label: "Drafts", value: "DRAFT", count: countOf(["DRAFT"]) },
          { label: "Paid", value: "PAID", count: countOf(["PAID"]) },
          { label: "Void", value: "VOID", count: countOf(["VOID"]) },
        ]}
        extra={<DateRangeFilter label="Invoice date" />}
      />

      <Card padded={false} className="p-5">
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices match"
            description={
              query || status || issuedBetween
                ? "Try clearing the filters or widening the date range."
                : "Create your first invoice to start tracking receivables."
            }
            action={<LinkButton href="/sales/invoices/new" variant="primary">New invoice</LinkButton>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="7rem">Number</Th>
                <Th>Customer</Th>
                <Th width="6.5rem">Date</Th>
                <Th width="8rem">Due</Th>
                <Th width="8rem" align="right">Total</Th>
                <Th width="8rem" align="right">Balance</Th>
                <Th width="7.5rem">Status</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const overdueDays = daysBetween(invoice.dueDate, asOf);
                return (
                  <Tr key={invoice.id}>
                    <Td>
                      <Link href={`/sales/invoices/${invoice.id}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                        {invoice.number}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/sales/customers/${invoice.customer.id}`} className="hover:text-brand-700 hover:underline">
                        {invoice.customer.name}
                      </Link>
                      {invoice.memo && <span className="block truncate text-[0.75rem] text-muted-ink">{invoice.memo}</span>}
                    </Td>
                    <Td className="text-muted-ink">{formatDate(invoice.issueDate)}</Td>
                    <Td>
                      {formatDate(invoice.dueDate)}
                      {invoice.balanceCents > 0 && overdueDays > 0 && (
                        <span className="ml-1.5 text-[0.75rem] font-medium text-negative">{overdueDays}d late</span>
                      )}
                    </Td>
                    <Td align="right"><Money cents={invoice.totalCents} /></Td>
                    <Td align="right">
                      <Money cents={invoice.balanceCents} bold={invoice.balanceCents > 0} blankZero />
                    </Td>
                    <Td>
                      <StatusBadge
                        status={
                          invoice.balanceCents > 0 && overdueDays > 0 && invoice.status !== "VOID"
                            ? "OVERDUE"
                            : invoice.status
                        }
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={4} className="pt-3 font-medium text-ink-700">
                  {invoices.length} invoice{invoices.length === 1 ? "" : "s"} shown
                </Td>
                <Td align="right" className="pt-3">
                  <Money cents={invoices.reduce((s, i) => s + (i.status === "VOID" ? 0 : i.totalCents), 0)} bold />
                </Td>
                <Td align="right" className="pt-3">
                  <Money cents={invoices.reduce((s, i) => s + i.balanceCents, 0)} bold />
                </Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
