import Link from "next/link";
import { listPayments } from "@/server/db/payments";
import { listAllocationsForPayment } from "@/server/db/payment-allocations";
import { getCustomer } from "@/server/db/customers";
import { getVendor } from "@/server/db/vendors";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { bills as billsRepo } from "@/server/db/bills";
import { formatDate, fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge, Card, EmptyState, LinkButton, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { RangePicker } from "@/components/filter-bar";
import { PaymentVoidButton } from "./payment-void-button";

/**
 * Receipts (money in) and vendor payments (money out) share a table — the only
 * difference is which party column is shown and where it links.
 */
export async function PaymentListPage({
  companyId,
  companyName,
  fiscalYearStartMonth,
  currency,
  type,
  searchParams,
  voidAction,
}: {
  companyId: string;
  companyName: string;
  fiscalYearStartMonth: number;
  currency: string;
  type: "RECEIPT" | "PAYMENT";
  searchParams: Record<string, string | string[] | undefined>;
  voidAction: (paymentId: string) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const defaults = fiscalYearRange(fiscalYearOf(today(), fiscalYearStartMonth), fiscalYearStartMonth);
  const from = toUtcDay(typeof searchParams.from === "string" ? searchParams.from : isoDate(defaults.start));
  const to = toUtcDay(typeof searchParams.to === "string" ? searchParams.to : isoDate(today()));

  const inPeriod = (await listPayments(companyId, { type }))
    .filter((p) => p.date >= from && p.date <= to)
    .slice(0, 200);

  const [allInvoices, allBills] = await Promise.all([
    invoicesRepo.list(companyId),
    billsRepo.list(companyId),
  ]);
  const invoiceById = new Map(allInvoices.map((i) => [i.id, i]));
  const billById = new Map(allBills.map((b) => [b.id, b]));
  const partyName = new Map<string, string>();
  await Promise.all(
    inPeriod.flatMap((p) => [
      p.customerId ? getCustomer(companyId, p.customerId).then((c) => c && partyName.set(p.customerId!, c.name)) : null,
      p.vendorId ? getVendor(companyId, p.vendorId).then((v) => v && partyName.set(p.vendorId!, v.name)) : null,
    ]).filter(Boolean) as Promise<unknown>[],
  );

  const payments = await Promise.all(
    inPeriod.map(async (p) => {
      const allocations = (await listAllocationsForPayment(companyId, p.id)).map((a) => ({
        ...a,
        invoice: a.invoiceId
          ? invoiceById.get(a.invoiceId)
            ? { id: a.invoiceId, number: invoiceById.get(a.invoiceId)!.number }
            : null
          : null,
        bill: a.billId
          ? billById.get(a.billId)
            ? { id: a.billId, number: billById.get(a.billId)!.number }
            : null
          : null,
      }));
      return {
        ...p,
        customer: p.customerId ? { id: p.customerId, name: partyName.get(p.customerId) ?? "—" } : null,
        vendor: p.vendorId ? { id: p.vendorId, name: partyName.get(p.vendorId) ?? "—" } : null,
        allocations,
      };
    }),
  );

  const isReceipt = type === "RECEIPT";
  const detailHref = isReceipt ? "/sales/receipts" : "/purchases/payments";
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
            ? `${formatMoney(totalCents, { currency })} received in this period. Each receipt posts Dr Bank / Cr Accounts receivable and is applied to the invoices it settles.`
            : `${formatMoney(totalCents, { currency })} paid in this period. Each payment posts Dr Accounts payable / Cr Bank and is applied to the bills it settles.`
        }
        actions={
          <LinkButton href={`${detailHref}/new`} variant="primary">
            <Icon name="plus" className="h-3.5 w-3.5" />
            {isReceipt ? "New receipt" : "New payment"}
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangePicker from={isoDate(from)} to={isoDate(to)} />
        {unappliedCents > 0 && (
          <span className="rounded-full bg-caution-soft px-3 py-1 text-[0.8125rem] font-medium text-caution">
            {formatMoney(unappliedCents, { currency })} unapplied
          </span>
        )}
      </div>

      <Card className="p-5">
        {payments.length === 0 ? (
          <EmptyState
            title="No payments in this period"
            description={isReceipt ? `Record a receipt, or match one in the bank review queue.` : `Pay a bill, or match the payment in the bank review queue.`}
            action={<LinkButton href={`${detailHref}/new`} variant="primary">{isReceipt ? "New receipt" : "New payment"}</LinkButton>}
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
                <Th width="4rem" align="right">{""}</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const party = isReceipt ? payment.customer : payment.vendor;
                const partyHref = isReceipt ? "/sales/customers" : "/purchases/vendors";
                return (
                  <Tr key={payment.id}>
                    <Td>
                      <Link href={`${detailHref}/${payment.id}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                        {payment.number}
                      </Link>
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
                    <Td align="right">
                      {payment.status === "POSTED" && <PaymentVoidButton paymentId={payment.id} voidAction={voidAction} />}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={5} className="pt-3 font-medium text-ink-700">{payments.length} payment(s)</Td>
                <Td align="right" className="pt-3"><Money cents={totalCents} bold /></Td>
                <Td align="right" className="pt-3"><Money cents={unappliedCents} bold /></Td>
                <Td className="pt-3" />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
