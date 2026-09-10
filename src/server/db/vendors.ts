import "server-only";

import { converter, mapDocs, newId, sub, toTimestamp, type Tx } from "./firestore";
import type { Vendor } from "./types";

/** `companies/{companyId}/vendors/{id}` — contacts embedded. Replaces `db.vendor.*`. */

const { decode, encode } = converter<Vendor>(["createdAt", "updatedAt"]);
const col = (companyId: string) => sub(companyId, "vendors");

export async function getVendor(companyId: string, id: string): Promise<Vendor | null> {
  const snap = await col(companyId).doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function getVendorTx(tx: Tx, companyId: string, id: string): Promise<Vendor | null> {
  const snap = await tx.get(col(companyId).doc(id));
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listVendors(
  companyId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<Vendor[]> {
  let q = col(companyId).orderBy("name");
  if (opts.activeOnly) q = col(companyId).where("isActive", "==", true).orderBy("name");
  return mapDocs(await q.get(), decode);
}

export type NewVendor = { companyId: string; name: string } & Partial<Vendor>;

export async function createVendor(input: NewVendor): Promise<Vendor> {
  const id = input.id ?? newId();
  const now = new Date();
  const row: Vendor = {
    displayName: null,
    email: null,
    phone: null,
    addressLine1: null,
    city: null,
    province: null,
    postalCode: null,
    country: "CA",
    taxCodeId: null,
    paymentTermsDays: 30,
    businessNumber: null,
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

export async function updateVendor(
  companyId: string,
  id: string,
  data: Partial<Vendor>,
): Promise<void> {
  await col(companyId).doc(id).update({ ...encode(data), updatedAt: toTimestamp(new Date()) });
}

export async function deleteVendor(companyId: string, id: string): Promise<void> {
  await col(companyId).doc(id).delete();
}
