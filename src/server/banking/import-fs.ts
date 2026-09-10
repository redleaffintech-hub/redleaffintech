import "server-only";

/**
 * Bank feed ingestion (§11) — Firestore implementation.
 *
 * The CSV / OFX parsers are pure and re-exported unchanged from ./import; only
 * `importTransactions` (the write) is reimplemented here.
 */

import { toUtcDay } from "@/lib/dates";
import { bankAccounts } from "@/server/db/banking";
import { newId, sub, toTimestamp } from "@/server/db/firestore";
import {
  normalizeDescription,
  parseCsv,
  parseOfx,
  type NormalizedTransaction,
} from "./import";

export { normalizeDescription, parseCsv, parseOfx, type NormalizedTransaction };

export interface ImportResult {
  batchId: string;
  imported: number;
  duplicates: number;
  errors: string[];
}

export async function importTransactions(
  companyId: string,
  bankAccountId: string,
  rows: NormalizedTransaction[],
): Promise<ImportResult> {
  const batchId = `IMP-${Date.now().toString(36).toUpperCase()}`;
  let imported = 0;
  let duplicates = 0;

  const bankAccount = await bankAccounts.get(companyId, bankAccountId);
  if (!bankAccount) throw new Error("Bank account not found in this company.");

  // Load the account's existing lines once for duplicate detection rather than
  // a query per row.
  const existing = await sub(companyId, "bankTransactions")
    .where("bankAccountId", "==", bankAccountId)
    .get();
  const byFitId = new Set<string>();
  const byComposite = new Set<string>();
  for (const d of existing.docs) {
    const t = d.data();
    if (t.fitId) byFitId.add(String(t.fitId));
    const ts = (t.date as FirebaseFirestore.Timestamp)?.toDate?.();
    byComposite.add(`${ts?.toISOString().slice(0, 10)}|${t.amountCents}|${t.normalizedDesc}`);
  }

  const writer = sub(companyId, "bankTransactions").firestore.bulkWriter();
  for (const row of rows) {
    const normalizedDesc = normalizeDescription(row.description);
    const date = toUtcDay(row.date);
    const dupKey = `${date.toISOString().slice(0, 10)}|${row.amountCents}|${normalizedDesc}`;

    if (row.fitId ? byFitId.has(row.fitId) : byComposite.has(dupKey)) {
      duplicates++;
      continue;
    }
    if (row.fitId) byFitId.add(row.fitId);
    else byComposite.add(dupKey);

    const id = newId();
    writer.set(sub(companyId, "bankTransactions").doc(id), {
      companyId,
      bankAccountId,
      date: toTimestamp(date),
      description: row.description,
      normalizedDesc,
      reference: row.reference ?? null,
      amountCents: row.amountCents,
      runningBalanceCents: row.balanceCents ?? null,
      status: "UNMATCHED",
      matchedType: null,
      matchedId: null,
      categoryAccountId: null,
      journalEntryId: null,
      reconciliationId: null,
      importBatchId: batchId,
      fitId: row.fitId ?? null,
      isDuplicate: false,
      appliedRuleId: null,
      createdAt: toTimestamp(new Date()),
    });
    imported++;
  }
  await writer.close();

  await bankAccounts.update(companyId, bankAccountId, { lastImportAt: new Date() });
  return { batchId, imported, duplicates, errors: [] };
}
