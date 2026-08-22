import Link from "next/link";
import { db } from "@/lib/db";
import { contains } from "@/lib/search";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, today, daysBetween, dateRangeWhere } from "@/lib/dates";
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
  // The range narrows by invoice date, which is the date the revenue was
  // recognised — not the due date, which would answer a different question.
  const issuedBetween = dateRangeWhere(params.from, params.to);

  const asOfNow = today();

  /**
   * "Overdue" is a fact about the due date, not a stored flag — deriving it
   * keeps the list honest without a nightly job having to have run.
   */
  const openStatuses = { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } };
  const where = {
    companyId: company.id,
    ...(status === "OPEN"
      ? openStatuses
      : status === "OVERDUE"
        ? { ...openStatuses, balanceCents: { gt: 0 }, dueDate: { lt: asOfNow } }
        : status
          ? { status }
          : {}),
    ...(query
      ? { OR: [{ number: contains(query) }, { customer: { name: contains(query) } }] }
      : {}),
    ...(issuedBetween ? { issueDate: issuedBetween } : {}),
  };

  const [invoices, counts, totals, overdueCount] = await Promise.all([
    db.invoice.findMany({
      where,
      include: { customer: { select: { id: true, name: true } } },
      orderBy: [{ issueDate: "desc" }, { number: "desc" }],
      take: 150,
    }),
    db.invoice.groupBy({ by: ["status"], where: { companyId: company.id }, _count: true }),
    db.invoice.aggregate({
      where: { companyId: company.id, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      _sum: { balanceCents: true },
    }),
    db.invoice.count({
      where: { companyId: company.id, ...openStatuses, balanceCents: { gt: 0 }, dueDate: { lt: asOfNow } },
    }),
  ]);

  const countOf = (statuses: string[]) =>
    counts.filter((c) => statuses.includes(c.status)).reduce((s, c) => s + c._count, 0);

  const asOf = asOfNow;
  const outstandingCents = totals._sum.balanceCents ?? 0;

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
