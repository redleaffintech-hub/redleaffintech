import "server-only";

import { db } from "@/lib/db";
import { PROVINCES } from "@/lib/enums";
import { toCents, parseRateMicro } from "@/lib/money";
import { findOverlappingBracket } from "./tax-engine";

/**
 * Bulk CSV import for PayrollTaxBracket — the multi-row counterpart to the
 * single-bracket admin form (bracket-form.tsx / actions.ts). Built so a whole
 * jurisdiction/year bracket set — or several years across several
 * jurisdictions, such as a 5-year CRA/provincial backfill — can be loaded in
 * one reviewed batch instead of one row at a time.
 *
 * Every row still goes through the same validation and the same
 * findOverlappingBracket conflict check the single-row form uses; this module
 * only adds CSV parsing, cross-row duplicate/overlap detection within the
 * batch itself, and a single transactional insert.
 */

const JURISDICTIONS = new Set(["FEDERAL", ...PROVINCES.map((p) => p.code)]);
const REQUIRED_COLUMNS = ["jurisdiction", "effectivefrom", "effectiveto", "min", "max", "rate", "basicpersonalamount"];

export interface ParsedBracketRow {
  line: number;
  jurisdiction: string;
  minCents: number;
  maxCents: number | null;
  rateMicro: number;
  basicPersonalAmountCents: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface ParseResult {
  rows: ParsedBracketRow[];
  errors: string[];
}

/** Minimal RFC-4180 line splitter — handles quoted fields with embedded commas, doubled quotes. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

function parseDateOnly(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parses CSV text with header `jurisdiction,effectiveFrom,effectiveTo,min,max,rate,basicPersonalAmount`
 * (case-insensitive, column order insignificant) into validated rows. Returns
 * every row-level error found — the caller decides whether any error blocks
 * the whole import (it does; see `importBracketRows`).
 */
export function parseBracketCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: ["The file is empty."] };

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected header: jurisdiction,effectiveFrom,effectiveTo,min,max,rate,basicPersonalAmount`] };
  }
  const col = (name: string) => header.indexOf(name);

  const rows: ParsedBracketRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1; // 1-indexed, header is line 1
    const fields = splitCsvLine(lines[i]);
    const get = (name: string) => (fields[col(name)] ?? "").trim();

    const jurisdiction = get("jurisdiction").toUpperCase();
    if (!JURISDICTIONS.has(jurisdiction)) {
      errors.push(`Line ${lineNo}: unknown jurisdiction "${get("jurisdiction")}".`);
      continue;
    }

    const effectiveFrom = parseDateOnly(get("effectivefrom"));
    if (!effectiveFrom) {
      errors.push(`Line ${lineNo}: effectiveFrom must be YYYY-MM-DD.`);
      continue;
    }
    const effectiveToRaw = get("effectiveto");
    const effectiveTo = effectiveToRaw ? parseDateOnly(effectiveToRaw) : null;
    if (effectiveToRaw && !effectiveTo) {
      errors.push(`Line ${lineNo}: effectiveTo must be YYYY-MM-DD, or blank for ongoing.`);
      continue;
    }
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      errors.push(`Line ${lineNo}: effectiveTo must be after effectiveFrom.`);
      continue;
    }

    let minCents: number;
    try {
      minCents = toCents(get("min") || "0");
    } catch {
      errors.push(`Line ${lineNo}: "min" is not a valid amount.`);
      continue;
    }
    const maxRaw = get("max");
    let maxCents: number | null = null;
    if (maxRaw) {
      try {
        maxCents = toCents(maxRaw);
      } catch {
        errors.push(`Line ${lineNo}: "max" is not a valid amount.`);
        continue;
      }
    }
    if (maxCents !== null && maxCents <= minCents) {
      errors.push(`Line ${lineNo}: "max" must be greater than "min".`);
      continue;
    }

    const rateMicro = parseRateMicro(get("rate"));
    if (rateMicro === null) {
      errors.push(`Line ${lineNo}: "rate" is not a valid percentage.`);
      continue;
    }

    let basicPersonalAmountCents: number;
    try {
      basicPersonalAmountCents = toCents(get("basicpersonalamount"));
    } catch {
      errors.push(`Line ${lineNo}: "basicPersonalAmount" is not a valid amount.`);
      continue;
    }

    rows.push({ line: lineNo, jurisdiction, minCents, maxCents, rateMicro, basicPersonalAmountCents, effectiveFrom, effectiveTo });
  }

  return { rows, errors };
}

function setKey(jurisdiction: string, effectiveFrom: Date, effectiveTo: Date | null): string {
  return `${jurisdiction}|${effectiveFrom.getTime()}|${effectiveTo ? effectiveTo.getTime() : "null"}`;
}

export interface ImportOutcome {
  insertedCount: number;
  setCount: number;
  jurisdictions: string[];
}

/**
 * Validates the whole batch against itself and against the database, then
 * inserts every row in one transaction. All-or-nothing: a CSV meant to
 * backfill several years is only useful if every year lands, so a single bad
 * row (or a single real conflict) fails the entire import rather than leaving
 * a partially-loaded jurisdiction for pay runs to read from.
 */
export async function importBracketRows(rows: ParsedBracketRow[], reason: string, actorId: string): Promise<{ outcome?: ImportOutcome; error?: string }> {
  if (rows.length === 0) return { error: "No rows to import." };

  // Cross-row check: two different (jurisdiction, effectiveFrom, effectiveTo)
  // sets within the SAME batch must not describe overlapping time ranges.
  const sets = new Map<string, { jurisdiction: string; effectiveFrom: Date; effectiveTo: Date | null; lines: number[] }>();
  for (const row of rows) {
    const key = setKey(row.jurisdiction, row.effectiveFrom, row.effectiveTo);
    const existing = sets.get(key);
    if (existing) existing.lines.push(row.line);
    else sets.set(key, { jurisdiction: row.jurisdiction, effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, lines: [row.line] });
  }
  const setList = [...sets.values()];
  for (let i = 0; i < setList.length; i++) {
    for (let j = i + 1; j < setList.length; j++) {
      const a = setList[i];
      const b = setList[j];
      if (a.jurisdiction !== b.jurisdiction) continue;
      const aStart = a.effectiveFrom.getTime();
      const aEnd = a.effectiveTo ? a.effectiveTo.getTime() : Infinity;
      const bStart = b.effectiveFrom.getTime();
      const bEnd = b.effectiveTo ? b.effectiveTo.getTime() : Infinity;
      if (aStart === bStart && aEnd === bEnd) continue; // identical set, fine — just more rows of it
      if (aStart < bEnd && bStart < aEnd) {
        return { error: `${a.jurisdiction}: two different bracket sets in this file overlap (lines ${a.lines.join(",")} and lines ${b.lines.join(",")}).` };
      }
    }
  }

  // Database check: each set against every bracket already on file for that
  // jurisdiction (findOverlappingBracket already excludes an existing set
  // with the exact same [effectiveFrom, effectiveTo) range).
  for (const set of setList) {
    const overlap = await findOverlappingBracket({ jurisdiction: set.jurisdiction, effectiveFrom: set.effectiveFrom, effectiveTo: set.effectiveTo });
    if (overlap) {
      return {
        error: `${set.jurisdiction}: this file's ${set.effectiveFrom.toISOString().slice(0, 10)} set overlaps an existing bracket already on file (effective ${overlap.effectiveFrom.toISOString().slice(0, 10)}${overlap.effectiveTo ? ` to ${overlap.effectiveTo.toISOString().slice(0, 10)}` : ", ongoing"}). End or remove the existing set first.`,
      };
    }
  }

  // A single createMany, not one create() per row inside $transaction: an
  // interactive transaction holding hundreds of individual round trips to
  // Postgres routinely outruns Prisma's default 20s transaction timeout
  // (hit in practice backfilling 2022-2026 — 335 rows, rolled back clean with
  // no partial writes, but never completed). createMany is one statement.
  const { count } = await db.payrollTaxBracket.createMany({
    data: rows.map((row) => ({
      jurisdiction: row.jurisdiction,
      minCents: row.minCents,
      maxCents: row.maxCents,
      rateMicro: row.rateMicro,
      basicPersonalAmountCents: row.basicPersonalAmountCents,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      isActive: true,
      createdById: actorId,
      reason,
    })),
  });

  return {
    outcome: {
      insertedCount: count,
      setCount: setList.length,
      jurisdictions: [...new Set(rows.map((r) => r.jurisdiction))].sort(),
    },
  };
}
