/**
 * CSV serialisation for report exports.
 *
 * Deliberately small and dependency-free, but the details matter:
 *
 *  - RFC 4180 quoting. A field is quoted when it contains a comma, a quote, a
 *    CR or an LF; embedded quotes are doubled. Everything else is emitted bare.
 *  - CRLF line endings, which is what RFC 4180 specifies and what Excel is
 *    happiest with.
 *  - A UTF-8 BOM. Without it Excel on Windows reads the file as the system
 *    codepage and mangles every accented character — "Trésorerie" becomes
 *    "TrÃ©sorerie". The BOM is invisible to every other reader.
 *  - Formula-injection defence. A field that begins with =, +, - or @ is
 *    executed as a formula when the file is opened in Excel or Sheets, which
 *    turns an innocent-looking customer name into code running on the
 *    accountant's machine. Such fields are prefixed with a tab inside quotes,
 *    the OWASP-recommended neutralisation: it displays as the original text and
 *    is never evaluated. Numeric columns are exempt because they are produced
 *    by this module, never by user input.
 *
 * Money never passes through a float. Amounts arrive as integer minor units and
 * are split with integer arithmetic, so no cent can be lost to binary rounding
 * on the way out of the system.
 */

export type CsvValue = string | number | null | undefined;

export interface CsvColumn<T> {
  /** Human-readable heading, as it should appear in the spreadsheet. */
  header: string;
  /** Pull the cell out of the row. */
  value: (row: T) => CsvValue;
  /**
   * Numeric cells are written bare so a spreadsheet reads them as numbers, and
   * are exempt from formula-injection quoting.
   */
  numeric?: boolean;
}

const NEEDS_QUOTING = /[",\r\n]/;
const RISKY_PREFIX = /^[=+\-@\t\r]/;

function escapeField(raw: CsvValue, numeric: boolean): string {
  if (raw === null || raw === undefined) return "";
  let text = String(raw);
  if (text === "") return "";

  if (!numeric && RISKY_PREFIX.test(text)) {
    // Neutralise rather than strip: the reader still sees the original text.
    return `"\t${text.replace(/"/g, '""')}"`;
  }
  if (NEEDS_QUOTING.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Serialise rows to a CSV body. No BOM — see `csvFile`. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines: string[] = [columns.map((c) => escapeField(c.header, false)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(c.value(row), c.numeric === true)).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** The complete file body, BOM included, ready to send as a download. */
export function csvFile<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  return "﻿" + toCsv(rows, columns);
}

// ── Cell formatters ─────────────────────────────────────────────────────────

/**
 * Integer minor units to a plain decimal string: 123456 -> "1234.56".
 *
 * Integer arithmetic throughout. No thousands separators and no currency
 * symbol, because the cell has to parse as a number in the spreadsheet — the
 * currency belongs in the column heading (see `moneyHeader`).
 */
export function csvMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

/** rateMicro (rate x 1e6) to a percentage string: 130000 -> "13". */
export function csvRate(rateMicro: number | null | undefined): string {
  if (rateMicro === null || rateMicro === undefined) return "";
  const pct = rateMicro / 10_000;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** quantityMilli (qty x 1000) to a plain decimal string. */
export function csvQty(quantityMilli: number | null | undefined): string {
  if (quantityMilli === null || quantityMilli === undefined) return "";
  const q = quantityMilli / 1000;
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * ISO `YYYY-MM-DD`, always in UTC.
 *
 * Every date in this system is stored as a UTC midnight (see src/lib/dates.ts).
 * Formatting through the local timezone would shift a date across a boundary
 * and put an invoice in the wrong month for anyone west of Greenwich.
 */
export function csvDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** `Amount (CAD)` — the currency lives in the heading, not the cell. */
export function moneyHeader(label: string, currency: string): string {
  return `${label} (${currency})`;
}

// ── Filenames ───────────────────────────────────────────────────────────────

function slug(text: string): string {
  return text
    .toLowerCase()
    // "Profit & loss" -> "profit-and-loss", not "profit-loss".
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `trial-balance-2026-08-31.csv` */
export function asOfFilename(report: string, asOf: Date): string {
  return `${slug(report)}-${csvDate(asOf)}.csv`;
}

/** `profit-and-loss-2026-01-01-to-2026-08-31.csv` */
export function rangeFilename(report: string, from: Date, to: Date): string {
  return `${slug(report)}-${csvDate(from)}-to-${csvDate(to)}.csv`;
}

/**
 * A Content-Disposition value that survives non-ASCII names.
 *
 * A customer statement can be named "Café Lumière"; a bare `filename=` is
 * latin-1 only, so RFC 5987's `filename*` form carries the real name and the
 * ASCII fallback keeps older clients working.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
