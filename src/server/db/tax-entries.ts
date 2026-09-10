import "server-only";

import { converter, mapDocs, newId, sub, toTimestamp, type Tx } from "./firestore";
import type { TaxEntry } from "./types";

/**
 * `companies/{companyId}/taxEntries/{id}` — one row per tax component per source
 * line (§7, §12). Powers Tax Summary / Tax Detail and reconciles to the tax
 * control accounts. Replaces `db.taxEntry.*`.
 */

const { decode, encode } = converter<TaxEntry>(["date", "createdAt"]);
const col = (companyId: string) => sub(companyId, "taxEntries");

export async function listTaxEntriesInRange(
  companyId: string,
  from: Date,
  to: Date,
  opts: { direction?: string } = {},
): Promise<TaxEntry[]> {
  let q = col(companyId).where("date", ">=", toTimestamp(from)).where("date", "<=", toTimestamp(to));
  if (opts.direction) q = q.where("direction", "==", opts.direction);
  return mapDocs(await q.get(), decode);
}

export async function listTaxEntriesForSource(
  companyId: string,
  sourceType: string,
  sourceId: string,
): Promise<TaxEntry[]> {
  const snap = await col(companyId)
    .where("sourceType", "==", sourceType)
    .where("sourceId", "==", sourceId)
    .get();
  return mapDocs(snap, decode);
}

export async function listTaxEntriesForSourceTx(
  tx: Tx,
  companyId: string,
  sourceType: string,
  sourceId: string,
): Promise<TaxEntry[]> {
  const snap = await tx.get(
    col(companyId).where("sourceType", "==", sourceType).where("sourceId", "==", sourceId),
  );
  return mapDocs(snap, decode);
}

export interface NewTaxEntry {
  companyId: string;
  date: Date;
  direction: string;
  sourceType: string;
  sourceId: string;
  sourceNumber?: string | null;
  lineId?: string | null;
  taxCodeId: string;
  taxComponentId?: string | null;
  jurisdiction: string;
  kind: string;
  rateMicro: number;
  taxableCents: number;
  taxCents: number;
  recoverableCents?: number;
  journalEntryId?: string | null;
  taxPeriodId?: string | null;
  partyName?: string | null;
}

function build(input: NewTaxEntry): TaxEntry {
  return {
    id: newId(),
    companyId: input.companyId,
    date: input.date,
    direction: input.direction,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber ?? null,
    lineId: input.lineId ?? null,
    taxCodeId: input.taxCodeId,
    taxComponentId: input.taxComponentId ?? null,
    jurisdiction: input.jurisdiction,
    kind: input.kind,
    rateMicro: input.rateMicro,
    taxableCents: input.taxableCents,
    taxCents: input.taxCents,
    recoverableCents: input.recoverableCents ?? 0,
    journalEntryId: input.journalEntryId ?? null,
    taxPeriodId: input.taxPeriodId ?? null,
    partyName: input.partyName ?? null,
    createdAt: new Date(),
  };
}

export function createTaxEntriesTx(tx: Tx, inputs: NewTaxEntry[]): TaxEntry[] {
  const rows = inputs.map(build);
  for (const row of rows) tx.set(col(row.companyId).doc(row.id), encode(row));
  return rows;
}
