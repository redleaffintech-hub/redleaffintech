/**
 * CSV opening-balances import.
 *
 * Mirrors the bank-statement parser (`server/banking/import.ts`): a small
 * hand-rolled CSV splitter, loose header matching, and per-row errors that
 * never abort the whole file. Rows key off `Account.code`, which is unique
 * per company, so a typo produces a clear "no account with code X" rather than
 * a silent mismatch.
 */

import { toCents } from "@/lib/money";

export interface ParsedOpeningBalance {
  accountId: string;
  accountCode: string;
  debitCents?: number;
  creditCents?: number;
}

export interface OpeningBalancesParseResult {
  balances: ParsedOpeningBalance[];
  errors: string[];
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

const HEADER_ALIASES = {
  code: ["account code", "code", "account"],
  debit: ["debit"],
  credit: ["credit"],
} as const;

function findColumn(headers: string[], key: keyof typeof HEADER_ALIASES): number {
  const aliases: readonly string[] = HEADER_ALIASES[key];
  return headers.findIndex((h) => aliases.includes(h.toLowerCase().trim()));
}

/**
 * `accountsByCode` is keyed by lower-cased `Account.code` — the same template
 * the CSV export offers, so a round trip with nothing edited imports zero
 * balances rather than erroring.
 */
export function parseOpeningBalancesCsv(
  content: string,
  accountsByCode: Map<string, { id: string }>,
): OpeningBalancesParseResult {
  const errors: string[] = [];
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { balances: [], errors: ["File has no data rows."] };

  const headers = splitCsvLine(lines[0]);
  const codeCol = findColumn(headers, "code");
  const debitCol = findColumn(headers, "debit");
  const creditCol = findColumn(headers, "credit");

  if (codeCol === -1) {
    return { balances: [], errors: ["No account code column found. Expected a header such as 'Account code'."] };
  }
  if (debitCol === -1 && creditCol === -1) {
    return { balances: [], errors: ["No Debit or Credit column found."] };
  }

  const balances: ParsedOpeningBalance[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = splitCsvLine(line);
    const rawCode = cells[codeCol]?.trim();
    if (!rawCode) continue;

    const account = accountsByCode.get(rawCode.toLowerCase());
    if (!account) {
      errors.push(`Row ${index + 2}: no account with code "${rawCode}".`);
      continue;
    }

    try {
      const debitCents = debitCol !== -1 && cells[debitCol] ? toCents(cells[debitCol]) : 0;
      const creditCents = creditCol !== -1 && cells[creditCol] ? toCents(cells[creditCol]) : 0;
      if (debitCents === 0 && creditCents === 0) continue;
      if (debitCents !== 0 && creditCents !== 0) {
        errors.push(`Row ${index + 2} (${rawCode}): enter only a debit or only a credit, not both.`);
        continue;
      }
      balances.push({
        accountId: account.id,
        accountCode: rawCode,
        debitCents: debitCents || undefined,
        creditCents: creditCents || undefined,
      });
    } catch (error) {
      errors.push(`Row ${index + 2} (${rawCode}): ${(error as Error).message}`);
    }
  }
  return { balances, errors };
}
