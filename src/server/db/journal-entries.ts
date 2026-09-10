import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import {
  fromTimestamp,
  mapDocs,
  newId,
  sub,
  toTimestamp,
  type Tx,
} from "./firestore";
import type { JournalEntry, JournalEntryWithLines, JournalLine } from "./types";

/**
 * `companies/{companyId}/journalEntries/{id}` and
 * `companies/{companyId}/journalLines/{id}` (§5).
 *
 * Lines are a separate collection, not embedded, because reports scan them by
 * account + date across every entry. Each line denormalises `companyId`, `date`,
 * `accountId`, `accountType` for exactly those queries.
 *
 * Replaces `db.journalEntry.*` and `db.journalLine.*`.
 */

const entries = (companyId: string) => sub(companyId, "journalEntries");
const lines = (companyId: string) => sub(companyId, "journalLines");

const ENTRY_DATES = ["date", "postedAt", "createdAt"] as const;

function decodeEntry(raw: DocumentData, id: string): JournalEntry {
  const out = { id, ...raw } as Record<string, unknown>;
  for (const f of ENTRY_DATES) out[f] = fromTimestamp(raw[f]);
  return out as unknown as JournalEntry;
}

function encodeEntry(data: Partial<JournalEntry>): DocumentData {
  const out: DocumentData = { ...data };
  delete out.id;
  for (const f of ENTRY_DATES) if (f in out) out[f] = toTimestamp(out[f] as Date | null);
  return out;
}

function decodeLine(raw: DocumentData, id: string): JournalLine {
  return { id, ...raw, date: fromTimestamp(raw.date)! } as JournalLine;
}

function encodeLine(line: JournalLine): DocumentData {
  const { id: _id, ...rest } = line;
  void _id;
  return { ...rest, date: toTimestamp(line.date) };
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getEntry(
  companyId: string,
  id: string,
): Promise<JournalEntry | null> {
  const snap = await entries(companyId).doc(id).get();
  return snap.exists ? decodeEntry(snap.data()!, snap.id) : null;
}

/**
 * Journal entries in a date range (newest first), optionally one source type.
 * Replaces `db.journalEntry.findMany`.
 */
export async function listEntries(
  companyId: string,
  opts: { from?: Date; to?: Date; sourceType?: string } = {},
): Promise<JournalEntry[]> {
  let q: FirebaseFirestore.Query = entries(companyId);
  if (opts.from) q = q.where("date", ">=", toTimestamp(opts.from));
  if (opts.to) q = q.where("date", "<=", toTimestamp(opts.to));
  q = q.orderBy("date", "desc");
  let rows = mapDocs(await q.get(), decodeEntry);
  if (opts.sourceType) rows = rows.filter((e) => e.sourceType === opts.sourceType);
  return rows;
}

/** The entry that reversed this one, if any (`reversalOfId == entryId`). */
export async function findReversalOf(
  companyId: string,
  entryId: string,
): Promise<JournalEntry | null> {
  const snap = await entries(companyId)
    .where("reversalOfId", "==", entryId)
    .limit(1)
    .get();
  return snap.empty ? null : decodeEntry(snap.docs[0].data(), snap.docs[0].id);
}

/**
 * Every posted journal line for the company, up to and including `asOf`. Used by
 * the chart-of-accounts page to show per-account entry counts and balances
 * without a roll-up (Firestore has no GROUP BY).
 */
export async function listLinesUpTo(
  companyId: string,
  asOf: Date,
): Promise<JournalLine[]> {
  const snap = await lines(companyId).where("date", "<=", toTimestamp(asOf)).get();
  return mapDocs(snap, decodeLine);
}

/** How many posted journal lines reference an account (for delete guards). */
export async function countLinesForAccount(
  companyId: string,
  accountId: string,
): Promise<number> {
  const snap = await lines(companyId).where("accountId", "==", accountId).count().get();
  return snap.data().count;
}

export async function getLinesForEntry(
  companyId: string,
  entryId: string,
): Promise<JournalLine[]> {
  const snap = await lines(companyId)
    .where("journalEntryId", "==", entryId)
    .orderBy("lineNo")
    .get();
  return mapDocs(snap, decodeLine);
}

export async function getEntryWithLines(
  companyId: string,
  id: string,
): Promise<JournalEntryWithLines | null> {
  const entry = await getEntry(companyId, id);
  if (!entry) return null;
  return { ...entry, lines: await getLinesForEntry(companyId, id) };
}

export async function getEntryWithLinesTx(
  tx: Tx,
  companyId: string,
  id: string,
): Promise<JournalEntryWithLines | null> {
  const [entrySnap, lineSnap] = await Promise.all([
    tx.get(entries(companyId).doc(id)),
    tx.get(lines(companyId).where("journalEntryId", "==", id)),
  ]);
  if (!entrySnap.exists) return null;
  const entry = decodeEntry(entrySnap.data()!, entrySnap.id);
  const entryLines = mapDocs(lineSnap, decodeLine).sort((a, b) => a.lineNo - b.lineNo);
  return { ...entry, lines: entryLines };
}

export async function findEntryBySource(
  companyId: string,
  sourceType: string,
  sourceId: string,
): Promise<JournalEntry | null> {
  const snap = await entries(companyId)
    .where("sourceType", "==", sourceType)
    .where("sourceId", "==", sourceId)
    .limit(1)
    .get();
  return snap.empty ? null : decodeEntry(snap.docs[0].data(), snap.docs[0].id);
}

/** Year-end idempotency guard: a CLOSING entry already dated `date`. */
export async function findClosingEntryTx(
  tx: Tx,
  companyId: string,
  date: Date,
): Promise<JournalEntry | null> {
  const snap = await tx.get(
    entries(companyId)
      .where("sourceType", "==", "CLOSING")
      .where("date", "==", toTimestamp(date))
      .limit(1),
  );
  return snap.empty ? null : decodeEntry(snap.docs[0].data(), snap.docs[0].id);
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface EntryDraft {
  companyId: string;
  entryNo: string;
  date: Date;
  memo: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceNumber: string | null;
  isAdjusting: boolean;
  fiscalPeriodId: string | null;
  totalDebitCents: number;
  totalCreditCents: number;
  createdById: string | null;
}

export interface LineDraft {
  lineNo: number;
  accountId: string;
  accountType: string;
  description: string | null;
  debitCents: number;
  creditCents: number;
  customerId: string | null;
  vendorId: string | null;
  projectId: string | null;
  taxCodeId: string | null;
}

/**
 * Write a posted entry and its lines inside an open transaction. Returns the
 * hydrated entry. Caller is responsible for the roll-up increments (so it can
 * batch them with everything else in the same tx) and the audit row.
 */
export function createEntryTx(
  tx: Tx,
  draft: EntryDraft,
  lineDrafts: LineDraft[],
): JournalEntryWithLines {
  const id = newId();
  const now = new Date();
  const entry: JournalEntry = {
    id,
    companyId: draft.companyId,
    entryNo: draft.entryNo,
    date: draft.date,
    memo: draft.memo,
    sourceType: draft.sourceType,
    sourceId: draft.sourceId,
    sourceNumber: draft.sourceNumber,
    status: "POSTED",
    isAdjusting: draft.isAdjusting,
    reversalOfId: null,
    fiscalPeriodId: draft.fiscalPeriodId,
    totalDebitCents: draft.totalDebitCents,
    totalCreditCents: draft.totalCreditCents,
    createdById: draft.createdById,
    postedAt: now,
    createdAt: now,
  };
  tx.set(entries(draft.companyId).doc(id), encodeEntry(entry));

  const hydrated: JournalLine[] = lineDrafts.map((l) => ({
    id: newId(),
    journalEntryId: id,
    companyId: draft.companyId,
    date: draft.date,
    ...l,
  }));
  for (const line of hydrated) {
    tx.set(lines(draft.companyId).doc(line.id), encodeLine(line));
  }
  return { ...entry, lines: hydrated };
}

export function updateEntryTx(
  tx: Tx,
  companyId: string,
  id: string,
  data: Partial<JournalEntry>,
): void {
  tx.update(entries(companyId).doc(id), encodeEntry(data));
}
