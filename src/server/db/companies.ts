import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import {
  companyRef,
  db,
  fromTimestamp,
  runTransaction,
  toTimestamp,
  type Tx,
} from "./firestore";
import type { Company, NumberSequence } from "./types";

/**
 * `companies/{companyId}` — the company document, including the per-document
 * numbering counters that posting transactions bump.
 *
 * Replaces `db.company.*`.
 */

export const SEQUENCE_FIELD: Record<
  NumberSequence,
  { prefix: keyof Company; next: keyof Company; pad: number }
> = {
  invoice: { prefix: "invoicePrefix", next: "nextInvoiceNumber", pad: 0 },
  estimate: { prefix: "estimatePrefix", next: "nextEstimateNumber", pad: 0 },
  bill: { prefix: "billPrefix", next: "nextBillNumber", pad: 0 },
  credit: { prefix: "creditPrefix", next: "nextCreditNumber", pad: 0 },
  payment: { prefix: "paymentPrefix", next: "nextPaymentNumber", pad: 0 },
  journal: { prefix: "journalPrefix", next: "nextJournalNumber", pad: 5 },
  expense: { prefix: "expensePrefix", next: "nextExpenseNumber", pad: 0 },
  employee: { prefix: "employeePrefix", next: "nextEmployeeNumber", pad: 0 },
  payRun: { prefix: "payRunPrefix", next: "nextPayRunNumber", pad: 0 },
};

const DATE_FIELDS = ["archivedAt", "createdAt", "updatedAt"] as const;

function decode(raw: DocumentData, id: string): Company {
  const out = { id, ...raw } as Record<string, unknown>;
  for (const f of DATE_FIELDS) out[f] = fromTimestamp(raw[f]);
  return out as unknown as Company;
}

function encode(data: Partial<Company>): DocumentData {
  const out: DocumentData = { ...data };
  delete out.id;
  for (const f of DATE_FIELDS) {
    if (f in out) out[f] = toTimestamp(out[f] as Date | null);
  }
  return out;
}

export async function getCompany(id: string): Promise<Company | null> {
  const snap = await companyRef(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function getCompanyOrThrow(id: string): Promise<Company> {
  const company = await getCompany(id);
  if (!company) throw new Error(`Company ${id} not found.`);
  return company;
}

/** Read a company inside a transaction (reads must precede writes). */
export async function getCompanyTx(tx: Tx, id: string): Promise<Company | null> {
  const snap = await tx.get(companyRef(id));
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listCompanies(ids: string[]): Promise<Company[]> {
  if (ids.length === 0) return [];
  // getAll takes DocumentReference varargs; chunk to stay well within limits.
  const refs = ids.map((id) => companyRef(id));
  const snaps = await db.getAll(...refs);
  return snaps.filter((s) => s.exists).map((s) => decode(s.data()!, s.id));
}

/** Every company (platform admin lists). */
export async function listAllCompanies(): Promise<Company[]> {
  const snap = await db.collection("companies").get();
  return snap.docs.map((d) => decode(d.data(), d.id));
}

export async function updateCompany(
  id: string,
  data: Partial<Company>,
): Promise<void> {
  await companyRef(id).update({ ...encode(data), updatedAt: toTimestamp(new Date()) });
}

export function updateCompanyTx(tx: Tx, id: string, data: Partial<Company>): void {
  tx.update(companyRef(id), { ...encode(data), updatedAt: toTimestamp(new Date()) });
}

/**
 * Delete the company document. Only ever called for a company with no business
 * records (checked by the caller); Firestore has no cascade, so any leftover
 * setup scaffolding under it is orphaned harmlessly rather than removed.
 */
export async function deleteCompany(id: string): Promise<void> {
  await companyRef(id).delete();
}

/**
 * Consume the next number in a company sequence and return it formatted, e.g.
 * "JE-00042" or "INV-1042". MUST run inside a transaction so two concurrent
 * postings can never take the same number (replaces Prisma's
 * `update({ data: { nextJournalNumber: { increment: 1 } } })`).
 *
 * Call after any other `tx.get(...)` the caller needs — this issues a read.
 */
export async function bumpSequenceTx(
  tx: Tx,
  companyId: string,
  which: NumberSequence,
): Promise<string> {
  const spec = SEQUENCE_FIELD[which];
  const snap = await tx.get(companyRef(companyId));
  if (!snap.exists) throw new Error(`Company ${companyId} not found.`);
  const data = snap.data()!;
  const current = Number(data[spec.next] ?? 1);
  const prefix = String(data[spec.prefix] ?? "");
  tx.update(companyRef(companyId), { [spec.next]: current + 1 });
  const body = spec.pad > 0 ? String(current).padStart(spec.pad, "0") : String(current);
  return `${prefix}${body}`;
}

/**
 * The number the next document *would* take, without consuming it — for the
 * editor's "this will be INV-1042" hint. Nothing is reserved.
 */
export async function peekSequence(
  companyId: string,
  which: NumberSequence,
): Promise<string> {
  const spec = SEQUENCE_FIELD[which];
  const snap = await companyRef(companyId).get();
  if (!snap.exists) throw new Error(`Company ${companyId} not found.`);
  const data = snap.data()!;
  const current = Number(data[spec.next] ?? 1);
  const prefix = String(data[spec.prefix] ?? "");
  const body = spec.pad > 0 ? String(current).padStart(spec.pad, "0") : String(current);
  return `${prefix}${body}`;
}

export { runTransaction };
