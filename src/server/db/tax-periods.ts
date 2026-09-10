import "server-only";

import { converter, mapDocs, newId, sub, type Tx } from "./firestore";
import type { TaxPeriod } from "./types";

/** `companies/{companyId}/taxPeriods/{id}` (§7, §12). Replaces `db.taxPeriod.*`. */

const { decode, encode } = converter<TaxPeriod>([
  "startDate",
  "endDate",
  "filedAt",
  "lockedAt",
  "createdAt",
]);
const col = (companyId: string) => sub(companyId, "taxPeriods");

export async function getTaxPeriod(companyId: string, id: string): Promise<TaxPeriod | null> {
  const snap = await col(companyId).doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listTaxPeriods(companyId: string): Promise<TaxPeriod[]> {
  return mapDocs(await col(companyId).orderBy("startDate", "desc").get(), decode);
}

/**
 * The tax period covering `date`, if one is defined. Same one-range-field
 * workaround as fiscal periods: latest period starting on or before the date,
 * checked against its end.
 */
export async function findTaxPeriodTx(
  tx: Tx,
  companyId: string,
  date: Date,
): Promise<TaxPeriod | null> {
  const snap = await tx.get(
    col(companyId).where("startDate", "<=", date).orderBy("startDate", "desc").limit(1),
  );
  if (snap.empty) return null;
  const period = decode(snap.docs[0].data(), snap.docs[0].id);
  return period.endDate >= date ? period : null;
}

export async function findTaxPeriodForDate(
  companyId: string,
  date: Date,
): Promise<TaxPeriod | null> {
  const snap = await col(companyId)
    .where("startDate", "<=", date)
    .orderBy("startDate", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const period = decode(snap.docs[0].data(), snap.docs[0].id);
  return period.endDate >= date ? period : null;
}

export async function createTaxPeriod(
  input: Omit<TaxPeriod, "id" | "createdAt"> & { id?: string },
): Promise<TaxPeriod> {
  const id = input.id ?? newId();
  const row = { ...input, id, createdAt: new Date() } as TaxPeriod;
  await col(input.companyId).doc(id).set(encode(row));
  return row;
}

export async function updateTaxPeriod(
  companyId: string,
  id: string,
  data: Partial<TaxPeriod>,
): Promise<void> {
  await col(companyId).doc(id).update(encode(data));
}

export async function deleteTaxPeriod(companyId: string, id: string): Promise<void> {
  await col(companyId).doc(id).delete();
}
