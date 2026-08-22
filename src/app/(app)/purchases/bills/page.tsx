import Link from "next/link";
import { db } from "@/lib/db";
import { contains } from "@/lib/search";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, today, daysBetween } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge, Card, EmptyState, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Bills" };

export default async function BillsPage({ searchParams }: PageProps<"/purchases/bills">) {
  const { company } = await requireCapability(CAPABILITIES.BILLS);
  const currency = company.baseCurrency;
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "";
  const query = typeof params.q === "string" ? params.q : "";
  const asOf = today();

  const openStatuses = { status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] } };
  const where = {
    companyId: company.id,
    ...(status === "OPEN"
      ? openStatuses
      : status === "OVERDUE"
        ? { ...openStatuses, balanceCents: { gt: 0 }, dueDate: { lt: asOf } }
        : status
          ? { status }
          : {}),
    ...(query ? { OR: [{ number: contains(query) }, { vendor: { name: contains(query) } }, { vendorInvoiceNo: contains(query) }] } : {}),
  };

  const [bills, counts, totals, overdueCount] = await Promise.all([
    db.bill.findMany({
      where,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: [{ dueDate: "asc" }, { number: "desc" }],
      take: 150,
    }),
    db.bill.groupBy({ by: ["status"], where: { companyId: company.id }, _count: true }),
    db.bill.aggregate({ where: { companyId: company.id, ...openStatuses }, _sum: { balanceCents: true } }),
    db.bill.count({ where: { companyId: company.id, ...openStatuses, balanceCents: { gt: 0 }, dueDate: { lt: asOf } } }),
  ]);

  const countOf = (statuses: string[]) => counts.filter((c) => statuses.includes(c.status)).reduce((s, c) => s + c._count, 0);
  const owingCents = totals._sum.balanceCents ?? 0;

  return (
    <>
      <PageHeader
        title="Bills"
        description={
          owingCents > 0
            ? `${formatMoney(owingCents, { currency })} owing across ${countOf(["OPEN", "PARTIALLY_PAID", "OVERDUE"])} open bills.`
            : "Nothing outstanding to suppliers."
        }
        actions={
          <>
            <LinkButton href="/reports/ap-aging">A/P aging</LinkButton>
            <LinkButton href="/purchases/bills/new" variant="primary">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New bill
            </LinkButton>
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Search number, vendor or their invoice no…"
        tabs={[
          { label: "All", value: "" },
          { label: "Open", value: "OPEN", count: countOf(["OPEN", "PARTIALLY_PAID", "OVERDUE"]) },
          { label: "Overdue", value: "OVERDUE", count: overdueCount },
          { label: "Awaiting approval", value: "AWAITING_APPROVAL", count: countOf(["AWAITING_APPROVAL"]) },
          { label: "Drafts", value: "DRAFT", count: countOf(["DRAFT"]) },
          { label: "Paid", value: "PAID", count: countOf(["PAID"]) },
        ]}
      />

      <Card className="p-5">
        {bills.length === 0 ? (
          <EmptyState
            title="No bills match"
            description={query || status ? "Try clearing the filters." : "Record a vendor bill to start tracking payables."}
            action={<LinkButton href="/purchases/bills/new" variant="primary">New bill</LinkButton>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="7rem">Number</Th>
                <Th>Vendor</Th>
                <Th width="6.5rem">Date</Th>
                <Th width="8rem">Due</Th>
                <Th width="8rem" align="right">Total</Th>
                <Th width="8rem" align="right">Balance</Th>
                <Th width="8.5rem">Status</Th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => {
                const overdueDays = daysBetween(bill.dueDate, asOf);
                return (
                  <Tr key={bill.id}>
                    <Td>
                      <Link href={`/purchases/bills/${bill.id}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                        {bill.number}
                      </Link>
                      {bill.vendorInvoiceNo && (
                        <span className="block text-[0.6875rem] text-muted-ink">their ref {bill.vendorInvoiceNo}</span>
                      )}
                    </Td>
                    <Td>
                      <Link href={`/purchases/vendors/${bill.vendor.id}`} className="hover:text-brand-700 hover:underline">
                        {bill.vendor.name}
                      </Link>
                      {bill.memo && <span className="block truncate text-[0.75rem] text-muted-ink">{bill.memo}</span>}
                    </Td>
                    <Td className="text-muted-ink">{formatDate(bill.issueDate)}</Td>
                    <Td>
                      {formatDate(bill.dueDate)}
                      {bill.balanceCents > 0 && overdueDays > 0 && (
                        <span className="ml-1.5 text-[0.75rem] font-medium text-negative">{overdueDays}d late</span>
                      )}
                    </Td>
                    <Td align="right"><Money cents={bill.totalCents} /></Td>
                    <Td align="right"><Money cents={bill.balanceCents} bold={bill.balanceCents > 0} blankZero /></Td>
                    <Td>
                      <StatusBadge
                        status={
                          bill.balanceCents > 0 && overdueDays > 0 && !["VOID", "DRAFT", "AWAITING_APPROVAL"].includes(bill.status)
                            ? "OVERDUE"
                            : bill.status
                        }
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={4} className="pt-3 font-medium text-ink-700">{bills.length} bill(s) shown</Td>
                <Td align="right" className="pt-3">
                  <Money cents={bills.reduce((s, b) => s + (b.status === "VOID" ? 0 : b.totalCents), 0)} bold />
                </Td>
                <Td align="right" className="pt-3">
                  <Money cents={bills.reduce((s, b) => s + b.balanceCents, 0)} bold />
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
