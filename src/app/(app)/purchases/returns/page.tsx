import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, dateRangeWhere } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, EmptyState, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { DateRangeFilter } from "@/components/filter-bar";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Purchase returns" };

export default async function PurchaseReturnsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.BILLS);
  const currency = company.baseCurrency;
  const params = await searchParams;
  const issuedBetween = dateRangeWhere(params.from, params.to);

  const returns = await db.creditNote.findMany({
    where: {
      companyId: company.id,
      type: "VENDOR",
      sourceBillId: { not: null },
      ...(issuedBetween ? { issueDate: issuedBetween } : {}),
    },
    include: { vendor: { select: { id: true, name: true } }, sourceBill: { select: { id: true, number: true } } },
    orderBy: { issueDate: "desc" },
    take: 150,
  });

  const totalCents = returns.reduce((s, r) => s + r.totalCents, 0);

  return (
    <>
      <PageHeader
        title="Purchase returns"
        breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: "Purchase returns" }]}
        description={`${formatMoney(totalCents, { currency })} returned to vendors. Reduces stock at the original receipt cost and credits accounts payable.`}
        actions={
          <LinkButton href="/purchases/returns/new" variant="primary">
            <Icon name="plus" className="h-3.5 w-3.5" />
            New return
          </LinkButton>
        }
      />

      <div className="mb-4">
        <DateRangeFilter label="Return date" />
      </div>

      <Card padded={false}>
        {returns.length === 0 ? (
          <EmptyState
            title="No purchase returns yet"
            description="Open a posted bill and use its Create return action to return goods to a vendor."
            action={
              <LinkButton href="/purchases/returns/new" variant="primary">
                New return
              </LinkButton>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="7rem">Number</Th>
                <Th width="6.5rem">Date</Th>
                <Th>Vendor</Th>
                <Th>Source bill</Th>
                <Th width="9rem" align="right">Total</Th>
                <Th width="7rem">Status</Th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/sales/credit-notes/${r.id}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                      {r.number}
                    </Link>
                  </Td>
                  <Td className="text-muted-ink">{formatDate(r.issueDate)}</Td>
                  <Td>
                    {r.vendor ? (
                      <Link href={`/purchases/vendors/${r.vendor.id}`} className="hover:text-brand-700 hover:underline">
                        {r.vendor.name}
                      </Link>
                    ) : "—"}
                  </Td>
                  <Td>
                    {r.sourceBill ? (
                      <Link href={`/purchases/bills/${r.sourceBill.id}`} className="hover:text-brand-700 hover:underline">
                        {r.sourceBill.number}
                      </Link>
                    ) : "—"}
                  </Td>
                  <Td align="right"><Money cents={r.totalCents} /></Td>
                  <Td><StatusBadge status={r.status} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
