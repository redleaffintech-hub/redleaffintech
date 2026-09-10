import "server-only";

/**
 * Bank feed ingestion (§11).
 *
 * The parser is deliberately format-agnostic and returns a normalised shape, so
 * a future open-banking provider plugs in at `NormalizedTransaction[]` without
 * touching any downstream matching, rules or reconciliation code.
 * `importTransactions` (the write) targets Firestore.
 */

import { toCents } from "@/lib/money";
import { toUtcDay } from "@/lib/dates";
import { bankAccounts } from "@/server/db/banking";
import { newId, sub, toTimestamp } from "@/server/db/firestore";

// ── Pure parsers ────────────────────────────────────────────────────────────

export interface NormalizedTransaction {
  date: Date;
  description: string;
  amountCents: number;
  reference?: string;
  fitId?: string;
  balanceCents?: number;
}

/** Collapse noise so rules and duplicate detection compare like with like. */
export function normalizeDescription(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(current); current = "";
    } else current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim());
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "transaction date", "posted date", "posting date"],
  description: ["description", "details", "memo", "narrative", "payee", "transaction"],
  amount: ["amount", "value"],
  debit: ["debit", "withdrawal", "withdrawals", "money out", "paid out"],
  credit: ["credit", "deposit", "deposits", "money in", "paid in"],
  balance: ["balance", "running balance"],
  reference: ["reference", "ref", "cheque", "check number"],
};

function findColumn(headers: string[], key: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[key];
  return headers.findIndex((h) => aliases.includes(h.toLowerCase().trim()));
}

/**
 * Parse a bank CSV. Handles both single signed-amount exports and the
 * separate debit/credit column layout most Canadian banks produce.
 */
export function parseCsv(content: string): { rows: NormalizedTransaction[]; errors: string[] } {
  const errors: string[] = [];
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["File has no data rows."] };

  const headers = splitCsvLine(lines[0]);
  const dateCol = findColumn(headers, "date");
  const descCol = findColumn(headers, "description");
  const amountCol = findColumn(headers, "amount");
  const debitCol = findColumn(headers, "debit");
  const creditCol = findColumn(headers, "credit");
  const balanceCol = findColumn(headers, "balance");
  const refCol = findColumn(headers, "reference");

  if (dateCol === -1) errors.push("No date column found. Expected a header such as 'Date'.");
  if (descCol === -1) errors.push("No description column found.");
  if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
    errors.push("No amount column found. Expected 'Amount', or 'Debit' and 'Credit'.");
  }
  if (errors.length) return { rows: [], errors };

  const rows: NormalizedTransaction[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = splitCsvLine(line);
    try {
      const rawDate = cells[dateCol];
      const date = parseFlexibleDate(rawDate);
      if (!date) { errors.push(`Row ${index + 2}: cannot read the date "${rawDate}".`); continue; }

      let amountCents: number;
      if (amountCol !== -1 && cells[amountCol]) {
        amountCents = toCents(cells[amountCol]);
      } else {
        const debit = debitCol !== -1 && cells[debitCol] ? toCents(cells[debitCol]) : 0;
        const credit = creditCol !== -1 && cells[creditCol] ? toCents(cells[creditCol]) : 0;
        amountCents = credit - Math.abs(debit);
      }
      if (amountCents === 0) continue;

      rows.push({
        date,
        description: cells[descCol] || "(no description)",
        amountCents,
        reference: refCol !== -1 ? cells[refCol] : undefined,
        balanceCents: balanceCol !== -1 && cells[balanceCol] ? toCents(cells[balanceCol]) : undefined,
      });
    } catch (error) {
      errors.push(`Row ${index + 2}: ${(error as Error).message}`);
    }
  }
  return { rows, errors };
}

/** Minimal OFX/QFX reader — the format Canadian banks expose as "Quicken". */
export function parseOfx(content: string): { rows: NormalizedTransaction[]; errors: string[] } {
  const rows: NormalizedTransaction[] = [];
  const errors: string[] = [];
  const blocks = content.split(/<STMTTRN>/i).slice(1);
  for (const block of blocks) {
    const get = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
      return m ? m[1].trim() : "";
    };
    const raw = get("DTPOSTED");
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const day = Number(raw.slice(6, 8));
    if (!year || !month || !day) { errors.push(`Unreadable DTPOSTED "${raw}".`); continue; }
    const amount = get("TRNAMT");
    if (!amount) continue;
    rows.push({
      date: new Date(Date.UTC(year, month - 1, day)),
      description: get("NAME") || get("MEMO") || "(no description)",
      amountCents: toCents(amount),
      fitId: get("FITID") || undefined,
      reference: get("CHECKNUM") || undefined,
    });
  }
  if (rows.length === 0 && errors.length === 0) errors.push("No <STMTTRN> blocks found in this file.");
  return { rows, errors };
}

function parseFlexibleDate(value: string): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  let m = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Canadian bank exports are overwhelmingly DD/MM/YYYY or MM/DD/YYYY; when the
  // first field is > 12 it is unambiguously the day.
  m = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    return a > 12 ? new Date(Date.UTC(+m[3], b - 1, a)) : new Date(Date.UTC(+m[3], a - 1, b));
  }
  m = trimmed.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/);
  if (m) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthIndex = months.indexOf(m[2].toLowerCase());
    if (monthIndex >= 0) {
      const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return new Date(Date.UTC(year, monthIndex, +m[1]));
    }
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : toUtcDay(parsed);
}

// ── Firestore write ─────────────────────────────────────────────────────────

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
