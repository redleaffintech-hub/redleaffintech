import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import { fromTimestamp, mapDocs, sub, toTimestamp, type Tx } from "./firestore";
import type { FiscalPeriod } from "./types";

/**
 * `companies/{companyId}/fiscalPeriods/{fiscalYear}-{periodNumber}` — the
 * fiscal calendar. Deterministic id enforces
 * `@@unique([companyId, fiscalYear, periodNumber])`.
 *
 * Replaces `db.fiscalPeriod.*`.
 */

const DATE_FIELDS = ["startDate", "endDate", "closedAt", "reopenedAt"] as const;

function decode(raw: DocumentData, id: string): FiscalPeriod {
  const out = { id, ...raw } as Record<string, unknown>;
  for (const f of DATE_FIELDS) out[f] = fromTimestamp(raw[f]);
  return out as unknown as FiscalPeriod;
}

function encode(data: Partial<FiscalPeriod>): DocumentData {
  const out: DocumentData = { ...data };
  delete out.id;
  for (const f of DATE_FIELDS) if (f in out) out[f] = toTimestamp(out[f] as Date | null);
  return out;
}

const col = (companyId: string) => sub(companyId, "fiscalPeriods");
export const periodId = (fiscalYear: number, periodNumber: number) =>
  `${fiscalYear}-${String(periodNumber).padStart(2, "0")}`;

export async function getFiscalPeriod(
  companyId: string,
  id: string,
): Promise<FiscalPeriod | null> {
  const snap = await col(companyId).doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

/**
 * The fiscal period containing `date`. Firestore cannot range-filter two fields,
 * so this reads the latest period that started on or before `date` and checks
 * its end in code — correct because periods are contiguous and non-overlapping.
 */
export async function findPeriodForDateTx(
  tx: Tx,
  companyId: string,
  date: Date,
): Promise<FiscalPeriod | null> {
  const snap = await tx.get(
    col(companyId)
      .where("startDate", "<=", toTimestamp(date))
      .orderBy("startDate", "desc")
      .limit(1),
  );
  if (snap.empty) return null;
  const period = decode(snap.docs[0].data(), snap.docs[0].id);
  return period.endDate >= date ? period : null;
}

export async function listFiscalPeriods(
  companyId: string,
  opts: { fiscalYear?: number } = {},
): Promise<FiscalPeriod[]> {
  let q = col(companyId).orderBy("startDate");
  if (opts.fiscalYear !== undefined) {
    q = col(companyId).where("fiscalYear", "==", opts.fiscalYear).orderBy("startDate");
  }
  const snap = await q.get();
  return mapDocs(snap, decode);
}

export async function upsertFiscalPeriod(
  period: Omit<FiscalPeriod, "id"> & { id?: string },
): Promise<FiscalPeriod> {
  const id = period.id ?? periodId(period.fiscalYear, period.periodNumber);
  const row = { ...period, id } as FiscalPeriod;
  await col(period.companyId).doc(id).set(encode(row), { merge: true });
  return row;
}

export async function updateFiscalPeriod(
  companyId: string,
  id: string,
  data: Partial<FiscalPeriod>,
): Promise<void> {
  await col(companyId).doc(id).update(encode(data));
}

export function updateFiscalPeriodTx(
  tx: Tx,
  companyId: string,
  id: string,
  data: Partial<FiscalPeriod>,
): void {
  tx.update(col(companyId).doc(id), encode(data));
}

/** Bulk status change for a fiscal year (year-end lock). */
export async function setFiscalYearStatus(
  companyId: string,
  fiscalYear: number,
  data: Partial<FiscalPeriod>,
): Promise<number> {
  const periods = await listFiscalPeriods(companyId, { fiscalYear });
  const batch = col(companyId).firestore.batch();
  for (const p of periods) batch.update(col(companyId).doc(p.id), encode(data));
  await batch.commit();
  return periods.length;
}
