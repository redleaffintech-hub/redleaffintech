import "server-only";

import {
  companyRef,
  converter,
  mapDocs,
  newId,
  sub,
  toTimestamp,
  type Tx,
} from "./firestore";
import type { ServiceItem } from "./types";

/**
 * `companies/{companyId}/items/{id}` — the products & services catalogue
 * (ServiceItem). `[companyId, code]` uniqueness via a
 * `companies/{c}/itemCodes/{code}` guard doc. Replaces `db.serviceItem.*`.
 */

const { decode, encode } = converter<ServiceItem>(["createdAt", "updatedAt"]);
const col = (companyId: string) => sub(companyId, "items");
const codeGuard = (companyId: string, code: string) =>
  companyRef(companyId).collection("itemCodes").doc(code);

export async function getItem(companyId: string, id: string): Promise<ServiceItem | null> {
  const snap = await col(companyId).doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listItems(
  companyId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<ServiceItem[]> {
  let q = col(companyId).orderBy("name");
  if (opts.activeOnly) q = col(companyId).where("isActive", "==", true).orderBy("name");
  return mapDocs(await q.get(), decode);
}

export async function listItemsByIds(
  companyId: string,
  ids: string[],
): Promise<ServiceItem[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const out: ServiceItem[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await col(companyId)
      .where("__name__", "in", chunk.map((id) => col(companyId).doc(id)))
      .get();
    out.push(...mapDocs(snap, decode));
  }
  return out;
}

/** Tracked-inventory items among the given ids, read inside a transaction. */
export async function getTrackedItemsTx(
  tx: Tx,
  companyId: string,
  ids: string[],
): Promise<Map<string, ServiceItem>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, ServiceItem>();
  if (unique.length === 0) return map;
  const snaps = await tx.getAll(...unique.map((id) => col(companyId).doc(id)));
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const item = decode(snap.data()!, snap.id);
    if (item.trackInventory) map.set(item.id, item);
  }
  return map;
}

export type NewItem = { companyId: string; code: string; name: string } & Partial<ServiceItem>;

export async function createItem(input: NewItem): Promise<ServiceItem> {
  const id = input.id ?? newId();
  const now = new Date();
  const row: ServiceItem = {
    type: "SERVICE",
    description: null,
    unitPriceCents: 0,
    unit: "hour",
    discountPercentMicro: 0,
    incomeAccountId: null,
    expenseAccountId: null,
    taxCodeId: null,
    purchaseTaxCodeId: null,
    isActive: true,
    trackInventory: false,
    quantityOnHandMilli: 0,
    averageCostCents: 0,
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
  };
  await col(input.companyId).firestore.runTransaction(async (tx) => {
    const guardRef = codeGuard(input.companyId, input.code);
    if ((await tx.get(guardRef)).exists) {
      throw new Error(`Item code ${input.code} already exists in this company.`);
    }
    tx.set(col(input.companyId).doc(id), encode(row));
    tx.set(guardRef, { itemId: id });
  });
  return row;
}

export async function updateItem(
  companyId: string,
  id: string,
  data: Partial<ServiceItem>,
): Promise<void> {
  await col(companyId).doc(id).update({ ...encode(data), updatedAt: toTimestamp(new Date()) });
}

export function updateItemTx(
  tx: Tx,
  companyId: string,
  id: string,
  data: Partial<ServiceItem>,
): void {
  tx.update(col(companyId).doc(id), { ...encode(data), updatedAt: toTimestamp(new Date()) });
}

export async function deleteItem(companyId: string, id: string): Promise<void> {
  const item = await getItem(companyId, id);
  if (!item) return;
  await companyRef(companyId).firestore.runTransaction(async (tx) => {
    tx.delete(col(companyId).doc(id));
    tx.delete(codeGuard(companyId, item.code));
  });
}
