import "server-only";

import { companyRef, converter, mapDocs, newId, sub, type Tx } from "./firestore";
import type { TaxCode } from "./types";

/**
 * `companies/{companyId}/taxCodes/{id}` — components embedded (small, always
 * read with the code). `[companyId, code]` uniqueness via a
 * `companies/{c}/taxCodeCodes/{code}` guard doc. Replaces `db.taxCode.*`.
 */

const { decode, encode } = converter<TaxCode>(["effectiveFrom", "effectiveTo", "createdAt"]);
const col = (companyId: string) => sub(companyId, "taxCodes");
const codeGuard = (companyId: string, code: string) =>
  companyRef(companyId).collection("taxCodeCodes").doc(code);

export async function getTaxCode(companyId: string, id: string): Promise<TaxCode | null> {
  const snap = await col(companyId).doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listTaxCodes(
  companyId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<TaxCode[]> {
  let q = col(companyId).orderBy("code");
  if (opts.activeOnly) q = col(companyId).where("isActive", "==", true).orderBy("code");
  return mapDocs(await q.get(), decode);
}

export async function getTaxCodesByIds(
  companyId: string,
  ids: string[],
): Promise<Map<string, TaxCode>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, TaxCode>();
  if (unique.length === 0) return map;
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await col(companyId)
      .where("__name__", "in", chunk.map((id) => col(companyId).doc(id)))
      .get();
    for (const d of snap.docs) map.set(d.id, decode(d.data(), d.id));
  }
  return map;
}

/** Same, inside a transaction (document posting rates tax as of its date). */
export async function getTaxCodesByIdsTx(
  tx: Tx,
  companyId: string,
  ids: string[],
): Promise<Map<string, TaxCode>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, TaxCode>();
  if (unique.length === 0) return map;
  const snaps = await tx.getAll(...unique.map((id) => col(companyId).doc(id)));
  for (const snap of snaps) {
    if (snap.exists) map.set(snap.id, decode(snap.data()!, snap.id));
  }
  return map;
}

export async function createTaxCode(
  input: Omit<TaxCode, "id" | "createdAt"> & { id?: string },
): Promise<TaxCode> {
  const id = input.id ?? newId();
  const row = { ...input, id, createdAt: new Date() } as TaxCode;
  await col(input.companyId).firestore.runTransaction(async (tx) => {
    const guardRef = codeGuard(input.companyId, input.code);
    if ((await tx.get(guardRef)).exists) {
      throw new Error(`Tax code ${input.code} already exists in this company.`);
    }
    tx.set(col(input.companyId).doc(id), encode(row));
    tx.set(guardRef, { taxCodeId: id });
  });
  return row;
}

export async function updateTaxCode(
  companyId: string,
  id: string,
  data: Partial<TaxCode>,
): Promise<void> {
  await col(companyId).doc(id).update(encode(data));
}
