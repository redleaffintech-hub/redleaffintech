import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate, fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge, Card, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { RangePicker } from "@/components/filter-bar";

/**
 * Receipts (money in) and vendor payments (money out) share a table — the only
 * difference is which party column is shown and where it links.
 */
export async function PaymentListPage({
  companyId,
  companyName,
  fiscalYearStartMonth,
  type,
  searchParams,
}: {
  companyId: string;
  companyName: string;
  fiscalYearStartMonth: number;
  type: "RECEIPT" | "PAYMENT";
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const defaults = fiscalYearRange(fiscalYearOf(today(), fiscalYearStartMonth), fiscalYearStartMonth);
  const from = toUtcDay(typeof searchParams.from === "string" ? searchParams.from : isoDate(defaults.start));
  const to = toUtcDay(typeof searchParams.to === "string" ? searchParams.to : isoDate(today()));

  const payments = await db.payment.findMany({
    where: { companyId, type, date: { gte: from, lte: to } },
    include: {
      customer: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      allocations: { include: { invoice: { select: { id: true, number: true } }, bill: { select: { id: true, number: true } } } },
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  const isReceipt = type === "RECEIPT";
  const totalCents = payments.filter((p) => p.status !== "VOID").reduce((s, p) => s + p.amountCents, 0);
  const unappliedCents = payments.reduce((s, p) => s + p.unappliedCents, 0);

  return (
    <>
      <PageHeader
        title={isReceipt ? "Customer receipts" : "Vendor payments"}
        breadcrumb={[
          { label: isReceipt ? "Sales" : "Purchases", href: isReceipt ? "/sales/invoices" : "/purchases/bills" },
          { label: isReceipt ? "Receipts" : "Payments" },
        ]}
        description={
          isReceipt
            ? `${formatMoney(totalCents)} received in this period. Each receipt posts Dr Bank / Cr Accounts receivable and is applied to the invoices it settles.`
            : `${formatMoney(totalCents)} paid in this period. Each payment posts Dr Accounts payable / Cr Bank and is applied to the bills it settles.`
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangePicker from={isoDate(from)} to={isoDate(to)} />
        {unappliedCents > 0 && (
          <span className="rounded-full bg-caution-soft px-3 py-1 text-[0.8125rem] font-medium text-caution">
            {formatMoney(unappliedCents)} unapplied
          </span>
        )}
      </div>

      <Card className="p-5">
        {payments.length === 0 ? (
          <EmptyState
            title="No payments in this period"
            description={isReceipt ? "Record a receipt from an invoice, or match one in the bank review queue." : "Pay a bill, or match the payment in the bank review queue."}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="7rem">Number</Th>
                <Th width="6.5rem">Date</Th>
                <Th>{isReceipt ? "Customer" : "Vendor"}</Th>
                <Th>Applied to</Th>
                <Th width="6.5rem">Method</Th>
                <Th width="8rem" align="right">Amount</Th>
                <Th width="8rem" align="right">Unapplied</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const party = isReceipt ? payment.customer : payment.vendor;
                const partyHref = isReceipt ? "/sales/customers" : "/purchases/vendors";
                return (
                  <Tr key={payment.id}>
                    <Td>
                      {payment.journalEntryId ? (
                        <Link href={`/accounting/journals/${payment.journalEntryId}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                          {payment.number}
                        </Link>
                      ) : (
                        <span className="tnum font-medium">{payment.number}</span>
                      )}
                      {payment.status === "VOID" && <Badge className="ml-1.5">void</Badge>}
                    </Td>
                    <Td className="text-muted-ink">{formatDate(payment.date)}</Td>
                    <Td>
                      {party ? (
                        <Link href={`${partyHref}/${party.id}`} className="hover:text-brand-700 hover:underline">
                          {party.name}
                        </Link>
                      ) : (
                        <span className="text-muted-ink">—</span>
                      )}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1.5">
                        {payment.allocations.map((allocation) => {
                          const document = allocation.invoice ?? allocation.bill;
                          if (!document) return null;
                          const href = allocation.invoice ? `/sales/invoices/${document.id}` : `/purchases/bills/${document.id}`;
                          return (
                            <Link key={allocation.id} href={href} className="tnum rounded bg-paper-200 px-1.5 py-0.5 text-[0.75rem] text-ink-700 hover:bg-paper-300">
                              {document.number}
                            </Link>
                          );
                        })}
                        {payment.allocations.length === 0 && <span className="text-[0.75rem] text-muted-ink">Unapplied</span>}
                      </span>
                    </Td>
                    <Td className="text-[0.75rem] text-muted-ink">{payment.method}</Td>
                    <Td align="right"><Money cents={payment.amountCents} bold /></Td>
                    <Td align="right"><Money cents={payment.unappliedCents} blankZero /></Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={5} className="pt-3 font-medium text-ink-700">{payments.length} payment(s)</Td>
                <Td align="right" className="pt-3"><Money cents={totalCents} bold /></Td>
                <Td align="right" className="pt-3"><Money cents={unappliedCents} bold /></Td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
