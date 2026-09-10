import "server-only";

import { converter, mapDocs, newId, sub, type Tx } from "./firestore";
import type { PaymentAllocation } from "./types";

/**
 * `companies/{companyId}/paymentAllocations/{id}` — its own collection (not
 * embedded on the payment) because AR/AP aging queries it by `invoiceId` /
 * `billId` with an as-of-date. Replaces `db.paymentAllocation.*`.
 */

const { decode, encode } = converter<PaymentAllocation>(["date"]);
const col = (companyId: string) => sub(companyId, "paymentAllocations");

export async function listAllocationsForInvoice(
  companyId: string,
  invoiceId: string,
): Promise<PaymentAllocation[]> {
  return mapDocs(await col(companyId).where("invoiceId", "==", invoiceId).get(), decode);
}

export async function listAllocationsForBill(
  companyId: string,
  billId: string,
): Promise<PaymentAllocation[]> {
  return mapDocs(await col(companyId).where("billId", "==", billId).get(), decode);
}

export async function listAllocationsForCreditNote(
  companyId: string,
  creditNoteId: string,
): Promise<PaymentAllocation[]> {
  return mapDocs(await col(companyId).where("creditNoteId", "==", creditNoteId).get(), decode);
}

export async function listAllocationsForPayment(
  companyId: string,
  paymentId: string,
): Promise<PaymentAllocation[]> {
  return mapDocs(await col(companyId).where("paymentId", "==", paymentId).get(), decode);
}

export interface NewAllocation {
  companyId: string;
  paymentId?: string | null;
  invoiceId?: string | null;
  billId?: string | null;
  creditNoteId?: string | null;
  kind?: string;
  amountCents: number;
  date: Date;
}

function build(input: NewAllocation): PaymentAllocation {
  return {
    id: newId(),
    companyId: input.companyId,
    paymentId: input.paymentId ?? null,
    invoiceId: input.invoiceId ?? null,
    billId: input.billId ?? null,
    creditNoteId: input.creditNoteId ?? null,
    kind: input.kind ?? "PAYMENT",
    amountCents: input.amountCents,
    date: input.date,
  };
}

export function createAllocationsTx(tx: Tx, inputs: NewAllocation[]): PaymentAllocation[] {
  const rows = inputs.map(build);
  for (const row of rows) tx.set(col(row.companyId).doc(row.id), encode(row));
  return rows;
}

export async function deleteAllocationsForPaymentTx(
  tx: Tx,
  companyId: string,
  paymentId: string,
): Promise<void> {
  const snap = await tx.get(col(companyId).where("paymentId", "==", paymentId));
  for (const doc of snap.docs) tx.delete(doc.ref);
}
