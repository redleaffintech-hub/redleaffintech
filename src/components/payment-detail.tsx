import Link from "next/link";
import { getPayment } from "@/server/db/payments";
import { listAllocationsForPayment } from "@/server/db/payment-allocations";
import { getCustomer } from "@/server/db/customers";
import { getVendor } from "@/server/db/vendors";
import { getAccount } from "@/server/db/accounts";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { bills as billsRepo } from "@/server/db/bills";
import { formatDate } from "@/lib/dates";
import { Badge, Card, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { PaymentDetailActions } from "./payment-detail-actions";
import type { OpenDocument } from "./payment-form";

/**
 * Server-rendered detail for a single receipt or vendor payment — number,
 * party, method, its allocations (each linking through to the invoice or
 * bill it settled), and the void / apply-remaining actions.
 */
export async function PaymentDetailPage({
  companyId,
  companyName,
  currency,
  type,
  paymentId,
  voidAction,
  applyAction,
  openDocumentsAction,
}: {
  companyId: string;
  companyName: string;
  currency: string;
  type: "RECEIPT" | "PAYMENT";
  paymentId: string;
  voidAction: (paymentId: string) => Promise<{ error?: string; ok?: boolean }>;
  applyAction: (paymentId: string, payload: string) => Promise<{ error?: string; ok?: boolean }>;
  openDocumentsAction: (partyId: string) => Promise<OpenDocument[]>;
}) {
  const raw = await getPayment(companyId, paymentId);

  if (!raw || raw.type !== type) {
    return (
      <>
        <PageHeader title={type === "RECEIPT" ? "Receipt" : "Payment"} breadcrumb={[{ label: companyName }]} />
        <EmptyState title="Not found" description="This record does not exist in this company." />
      </>
    );
  }

  const [allocDocs, customerDoc, vendorDoc, bankAccount] = await Promise.all([
    listAllocationsForPayment(companyId, raw.id),
    raw.customerId ? getCustomer(companyId, raw.customerId) : Promise.resolve(null),
    raw.vendorId ? getVendor(companyId, raw.vendorId) : Promise.resolve(null),
    getAccount(companyId, raw.bankAccountId),
  ]);
  const allocations = await Promise.all(
    allocDocs.map(async (a) => ({
      ...a,
      invoice: a.invoiceId
        ? await invoicesRepo.get(companyId, a.invoiceId).then((i) =>
            i ? { id: i.id, number: i.number, balanceCents: i.balanceCents } : null,
          )
        : null,
      bill: a.billId
        ? await billsRepo.get(companyId, a.billId).then((b) =>
            b ? { id: b.id, number: b.number, balanceCents: b.balanceCents } : null,
          )
        : null,
    })),
  );
  const payment = {
    ...raw,
    customer: raw.customerId ? { id: raw.customerId, name: customerDoc?.name ?? "—" } : null,
    vendor: raw.vendorId ? { id: raw.vendorId, name: vendorDoc?.name ?? "—" } : null,
    allocations,
  };

  const isReceipt = type === "RECEIPT";
  const party = isReceipt ? payment.customer : payment.vendor;
  const partyHref = isReceipt ? "/sales/customers" : "/purchases/vendors";
  const listHref = isReceipt ? "/sales/receipts" : "/purchases/payments";

  return (
    <>
      <PageHeader
        title={`${isReceipt ? "Receipt" : "Payment"} ${payment.number}`}
        breadcrumb={[
          { label: isReceipt ? "Sales" : "Purchases", href: isReceipt ? "/sales/invoices" : "/purchases/bills" },
          { label: isReceipt ? "Receipts" : "Payments", href: listHref },
          { label: payment.number },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={payment.status === "VOID" ? "neutral" : "positive"}>{payment.status.toLowerCase()}</Badge>
            {payment.unappliedCents > 0 && payment.status !== "VOID" && (
              <Badge tone="caution"><Money cents={payment.unappliedCents} currency={currency} /> unapplied</Badge>
            )}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <dl className="grid gap-3 text-[0.8125rem] sm:grid-cols-2">
              <Row label={isReceipt ? "Customer" : "Vendor"}>
                {party ? (
                  <Link href={`${partyHref}/${party.id}`} className="font-medium text-brand-700 hover:underline">
                    {party.name}
                  </Link>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Date">{formatDate(payment.date)}</Row>
              <Row label="Method">{payment.method}</Row>
              <Row label="Reference">{payment.reference || "—"}</Row>
              <Row label={isReceipt ? "Deposited to" : "Paid from"}>{bankAccount?.name ?? "—"}</Row>
              <Row label="Amount"><Money cents={payment.amountCents} bold /></Row>
              {payment.memo && (
                <Row label="Memo">
                  <span className="text-ink-700">{payment.memo}</span>
                </Row>
              )}
              {payment.journalEntryId && (
                <Row label="Journal entry">
                  <Link href={`/accounting/journals/${payment.journalEntryId}`} className="font-medium text-brand-700 hover:underline">
                    View posting
                  </Link>
                </Row>
              )}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-[0.9375rem] font-semibold text-ink-900">Applied to</h2>
            {payment.allocations.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-ink">Nothing applied yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Document</Th>
                    <Th width="9rem" align="right">Amount applied</Th>
                  </tr>
                </thead>
                <tbody>
                  {payment.allocations.map((allocation) => {
                    // A payment's own allocations are always to an invoice or a bill —
                    // a credit note settles a document directly, without a Payment record.
                    const document = allocation.invoice ?? allocation.bill;
                    const href = allocation.invoice
                      ? `/sales/invoices/${allocation.invoice.id}`
                      : `/purchases/bills/${allocation.bill?.id}`;
                    return (
                      <Tr key={allocation.id}>
                        <Td>
                          {document ? (
                            <Link href={href} className="font-medium text-brand-700 hover:underline">
                              {document.number}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td align="right"><Money cents={allocation.amountCents} /></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <aside className="sticky-below-header">
          <PaymentDetailActions
            paymentId={payment.id}
            status={payment.status}
            unappliedCents={payment.unappliedCents}
            partyId={party?.id ?? null}
            voidAction={voidAction}
            applyAction={applyAction}
            openDocumentsAction={openDocumentsAction}
          />
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink">{label}</dt>
      <dd className="mt-0.5 text-ink-900">{children}</dd>
    </div>
  );
}
