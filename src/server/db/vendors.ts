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

export async function createVendor(
  input: Omit<Vendor, "id" | "createdAt" | "updatedAt"> & Partial<Pick<Vendor, "id">>,
): Promise<Vendor> {
  const id = input.id ?? newId();
  const now = new Date();
  const row: Vendor = { ...input, id, createdAt: now, updatedAt: now } as Vendor;
  row.contacts ??= [];
  row.displayName ??= null;
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
