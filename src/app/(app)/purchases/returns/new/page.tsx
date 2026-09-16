import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Card, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { billReturnOptions } from "../actions";
import { PurchaseReturnForm } from "./return-form";

export const metadata = { title: "Purchase return" };

export default async function NewPurchaseReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ billId?: string }>;
}) {
  const { billId } = await searchParams;

  if (!billId) {
    const { company } = await requireCapability(CAPABILITIES.BILLS);
    const bills = await db.bill.findMany({
      where: { companyId: company.id, journalEntryId: { not: null }, status: { not: "VOID" } },
      include: { vendor: { select: { name: true } } },
      orderBy: { issueDate: "desc" },
      take: 100,
    });

    return (
      <>
        <PageHeader
          title="Purchase return"
          breadcrumb={[
            { label: "Purchases", href: "/purchases/bills" },
            { label: "Purchase returns", href: "/purchases/returns" },
            { label: "New" },
          ]}
          description="Choose the posted bill you're returning goods against."
        />
        <Card padded={false}>
          {bills.length === 0 ? (
            <EmptyState title="No posted bills yet" description="A purchase return needs a posted bill to return goods against." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th width="7rem">Number</Th>
                  <Th>Vendor</Th>
                  <Th width="7rem">Date</Th>
                  <Th width="9rem" align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => (
                  <Tr key={bill.id}>
                    <Td className="tnum font-medium text-ink-900">
                      <Link href={`/purchases/returns/new?billId=${bill.id}`} className="hover:text-brand-700 hover:underline">
                        {bill.number}
                      </Link>
                    </Td>
                    <Td>{bill.vendor.name}</Td>
                    <Td className="text-muted-ink">{formatDate(bill.issueDate)}</Td>
                    <Td align="right"><Money cents={bill.totalCents} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </>
    );
  }

  const options = await billReturnOptions(billId);
  if ("error" in options) {
    return (
      <>
        <PageHeader title="Purchase return" breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: "Purchase returns" }]} />
        <Card className="p-5">
          <p className="text-[0.8125rem] text-negative">{options.error}</p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Return goods to ${options.bill.vendor.name}`}
        breadcrumb={[
          { label: "Purchases", href: "/purchases/bills" },
          { label: "Purchase returns", href: "/purchases/returns" },
          { label: "New" },
        ]}
        description={`Against bill ${options.bill.number}.`}
      />
      <Card className="max-w-3xl p-5">
        <PurchaseReturnForm billId={options.bill.id} billNumber={options.bill.number} lines={options.lines} />
      </Card>
    </>
  );
}
