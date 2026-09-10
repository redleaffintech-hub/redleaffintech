import "server-only";

import { converter, mapDocs, newId, sub, type Tx } from "./firestore";
import type { Payment } from "./types";

/**
 * `companies/{companyId}/payments/{id}` — the cash posting. Allocations live in
 * their own collection (see payment-allocations.ts). Replaces `db.payment.*`.
 */

const { decode, encode } = converter<Payment>(["date", "postedAt", "createdAt"]);
const col = (companyId: string) => sub(companyId, "payments");

export async function getPayment(companyId: string, id: string): Promise<Payment | null> {
  const snap = await col(companyId).doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function getPaymentTx(tx: Tx, companyId: string, id: string): Promise<Payment | null> {
  const snap = await tx.get(col(companyId).doc(id));
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listPayments(
  companyId: string,
  opts: { type?: string; customerId?: string; vendorId?: string; limit?: number } = {},
): Promise<Payment[]> {
  let q: FirebaseFirestore.Query = col(companyId);
  if (opts.type) q = q.where("type", "==", opts.type);
  if (opts.customerId) q = q.where("customerId", "==", opts.customerId);
  if (opts.vendorId) q = q.where("vendorId", "==", opts.vendorId);
  q = q.orderBy("date", "desc");
  if (opts.limit) q = q.limit(opts.limit);
  return mapDocs(await q.get(), decode);
}

export function createPaymentTx(
  tx: Tx,
  input: Omit<Payment, "id" | "createdAt"> & { id?: string },
): Payment {
  const id = input.id ?? newId();
  const row: Payment = { ...input, id, createdAt: new Date() } as Payment;
  tx.set(col(input.companyId).doc(id), encode(row));
  return row;
}

export function updatePaymentTx(
  tx: Tx,
  companyId: string,
  id: string,
  data: Partial<Payment>,
): void {
  tx.update(col(companyId).doc(id), encode(data));
}

export async function updatePayment(
  companyId: string,
  id: string,
  data: Partial<Payment>,
): Promise<void> {
  await col(companyId).doc(id).update(encode(data));
}
