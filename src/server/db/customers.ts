import "server-only";

import { converter, mapDocs, newId, sub, toTimestamp, type Tx } from "./firestore";
import type { Customer } from "./types";

/** `companies/{companyId}/customers/{id}` — contacts embedded. Replaces `db.customer.*`. */

const { decode, encode } = converter<Customer>(["createdAt", "updatedAt"]);
const col = (companyId: string) => sub(companyId, "customers");

export async function getCustomer(companyId: string, id: string): Promise<Customer | null> {
  const snap = await col(companyId).doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function getCustomerTx(tx: Tx, companyId: string, id: string): Promise<Customer | null> {
  const snap = await tx.get(col(companyId).doc(id));
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listCustomers(
  companyId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<Customer[]> {
  let q = col(companyId).orderBy("name");
  if (opts.activeOnly) q = col(companyId).where("isActive", "==", true).orderBy("name");
  return mapDocs(await q.get(), decode);
}

export type NewCustomer = { companyId: string; name: string } & Partial<Customer>;

export async function createCustomer(input: NewCustomer): Promise<Customer> {
  const id = input.id ?? newId();
  const now = new Date();
  const row: Customer = {
    displayName: null,
    email: null,
    phone: null,
    website: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    province: null,
    postalCode: null,
    country: "CA",
    shipToLine1: null,
    shipToLine2: null,
    shipToCity: null,
    shipToProvince: null,
    shipToPostalCode: null,
    shipToCountry: null,
    taxCodeId: null,
    paymentTermsDays: 15,
    notes: null,
    isActive: true,
    openingBalanceCents: 0,
    contacts: [],
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
  };
  await col(input.companyId).doc(id).set(encode(row));
  return row;
}

export async function updateCustomer(
  companyId: string,
  id: string,
  data: Partial<Customer>,
): Promise<void> {
  await col(companyId).doc(id).update({ ...encode(data), updatedAt: toTimestamp(new Date()) });
}

export async function deleteCustomer(companyId: string, id: string): Promise<void> {
  await col(companyId).doc(id).delete();
}
