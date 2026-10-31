/**
 * Bulk opening balances from a CSV: one row per customer (A/R) or vendor (A/P).
 *
 * Each row creates the party and posts its opening balance through the same
 * `setOpeningBalance` the single-record forms use, so the result is identical to
 * typing them in by hand — a real posted invoice/bill that ages, statements and
 * payment allocation all treat like any other open item.
 *
 * `parseOpeningBalanceCsv` is pure and validates EVERYTHING before anything is
 * written: a file with one bad row imports nothing, so a client never ends up
 * with half a ledger and no idea which half.
 */
import { db } from "@/lib/db";
import { PROVINCES } from "@/lib/enums";
import { parseCsv } from "@/lib/csv-parse";
import { toCents } from "@/lib/money";
import { nextCustomerCode } from "./numbering";
import { setOpeningBalance } from "./opening-balance";

export type ImportKind = "CUSTOMER" | "VENDOR";

export const MAX_IMPORT_ROWS = 500;

export interface ImportRow {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  amountCents: number;
  asOf: string | null; // YYYY-MM-DD
}

export interface ParseResult {
  rows: ImportRow[];
  /** Row-level problems, `line` being the spreadsheet row (header = 1). Empty means safe to import. */
  errors: { line: number; message: string }[];
}

/** Header text a user may reasonably have typed, normalised (lower case, letters and digits only). */
const HEADER_ALIASES: Record<string, string[]> = {
  name: ["customername", "vendorname", "suppliername", "name", "customer", "vendor", "supplier"],
  email: ["email", "emailaddress"],
  phone: ["phone", "phonenumber", "telephone"],
  addressLine1: ["addressline1", "address1", "address", "street"],
  addressLine2: ["addressline2", "address2"],
  city: ["city", "town"],
  province: ["province", "state", "provinceterritory"],
  postalCode: ["postalcode", "postcode", "zip", "zipcode"],
  amount: ["openingbalance", "balance", "amount", "openingamount"],
  asOf: ["asofdate", "asof", "date", "balancedate", "openingdate"],
};
const REQUIRED = ["name", "amount", "asOf"] as const;
const REQUIRED_LABEL: Record<string, string> = { name: "Name", amount: "Opening Balance", asOf: "As of Date" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function provinceCode(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const hit = PROVINCES.find((p) => p.code === v.toUpperCase() || p.name.toLowerCase() === v.toLowerCase());
  return hit?.code ?? null;
}

function isoDate(raw: string): string | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseOpeningBalanceCsv(text: string, kind: ImportKind): ParseResult {
  const label = kind === "CUSTOMER" ? "customer" : "vendor";
  const errors: ParseResult["errors"] = [];
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    return { rows: [], errors: [{ line: 1, message: (e as Error).message }] };
  }
  if (table.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };

  const header = table[0].map(norm);
  const col: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[field] = idx;
  }
  const missing = REQUIRED.filter((f) => col[f] === undefined);
  if (missing.length) {
    return {
      rows: [],
      errors: [{ line: 1, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((m) => REQUIRED_LABEL[m]).join(", ")}. Download the template and keep its headings.` }],
    };
  }
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [{ line: 1, message: `A file can hold at most ${MAX_IMPORT_ROWS} rows; this one has ${table.length - 1}. Split it and upload in parts.` }] };
  }

  const cell = (r: string[], f: string) => (col[f] === undefined ? "" : (r[col[f]] ?? "").trim());
  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();

  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const fail = (message: string) => errors.push({ line, message });

    const name = cell(r, "name");
    if (!name) return fail(`${label[0].toUpperCase()}${label.slice(1)} name is required.`);
    if (name.length > 200) return fail("Name is longer than 200 characters.");
    const dupe = seen.get(name.toLowerCase());
    if (dupe) return fail(`"${name}" appears twice in the file (also on row ${dupe}).`);
    seen.set(name.toLowerCase(), line);

    const email = cell(r, "email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(`"${email}" is not a valid email address.`);

    const provRaw = cell(r, "province");
    const province = provRaw ? provinceCode(provRaw) : null;
    if (provRaw && !province) return fail(`"${provRaw}" is not a Canadian province or territory (use e.g. ON or Ontario).`);

    let amountCents: number;
    const amountRaw = cell(r, "amount");
    if (amountRaw === "") return fail("Opening Balance is required (use 0 for none).");
    try {
      amountCents = toCents(amountRaw);
    } catch {
      return fail(`"${amountRaw}" is not a valid amount.`);
    }
    if (amountCents < 0) return fail("Opening Balance cannot be negative.");
    if (amountCents > 99_999_999_999) return fail("Opening Balance is too large.");

    const asOfRaw = cell(r, "asOf");
    let asOf: string | null = null;
    if (amountCents > 0) {
      if (!asOfRaw) return fail("As of Date is required when there is a balance.");
      asOf = isoDate(asOfRaw);
      if (!asOf) return fail(`"${asOfRaw}" is not a valid date — use YYYY-MM-DD, e.g. 2026-03-31.`);
    }

    const clip = (v: string, max: number, what: string) => (v.length > max ? fail(`${what} is too long.`) : true);
    if (clip(cell(r, "phone"), 40, "Phone") !== true || clip(cell(r, "addressLine1"), 200, "Address Line 1") !== true ||
        clip(cell(r, "addressLine2"), 200, "Address Line 2") !== true || clip(cell(r, "city"), 100, "City") !== true ||
        clip(cell(r, "postalCode"), 20, "Postal Code") !== true) return;

    rows.push({
      line, name,
      email: email || null,
      phone: cell(r, "phone") || null,
      addressLine1: cell(r, "addressLine1") || null,
      addressLine2: cell(r, "addressLine2") || null,
      city: cell(r, "city") || null,
      province,
      postalCode: cell(r, "postalCode").toUpperCase() || null,
      amountCents,
      asOf,
    });
  });

  return { rows, errors };
}

export interface ImportOutcome {
  created: { name: string; amountCents: number }[];
  /** Rows that failed AFTER validation passed (e.g. a closed fiscal period). Earlier rows stay imported. */
  failed: { line: number; name: string; message: string }[];
}

/**
 * Create the parties and post their balances. Rows that clash with an existing
 * party by name are rejected up front (same rule as the single-record forms).
 */
export async function findExistingNames(companyId: string, kind: ImportKind, names: string[]): Promise<Set<string>> {
  const where = { companyId, name: { in: names, mode: "insensitive" as const } };
  const found = kind === "CUSTOMER"
    ? await db.customer.findMany({ where, select: { name: true } })
    : await db.vendor.findMany({ where, select: { name: true } });
  return new Set(found.map((f) => f.name.toLowerCase()));
}

export async function importOpeningBalances(input: {
  companyId: string;
  userId: string;
  kind: ImportKind;
  rows: ImportRow[];
}): Promise<ImportOutcome> {
  const { companyId, userId, kind, rows } = input;
  const outcome: ImportOutcome = { created: [], failed: [] };

  for (const row of rows) {
    try {
      let partyId: string;
      if (kind === "CUSTOMER") {
        const customer = await db.$transaction(async (tx) => {
          const displayCode = await nextCustomerCode(tx, companyId);
          return tx.customer.create({
            data: {
              companyId, name: row.name, email: row.email, phone: row.phone,
              addressLine1: row.addressLine1, addressLine2: row.addressLine2, city: row.city,
              province: row.province, postalCode: row.postalCode,
              // Shipping address is kept the same as billing, per the template spec.
              shipToLine1: row.addressLine1, shipToLine2: row.addressLine2, shipToCity: row.city,
              shipToProvince: row.province, shipToPostalCode: row.postalCode,
              displayCode,
            },
            select: { id: true },
          });
        });
        partyId = customer.id;
      } else {
        const vendor = await db.vendor.create({
          data: {
            companyId, name: row.name, email: row.email, phone: row.phone,
            addressLine1: row.addressLine1, city: row.city, province: row.province, postalCode: row.postalCode,
            // Vendors have a single address line; a second one is kept, not dropped.
            notes: row.addressLine2 ? `Address line 2: ${row.addressLine2}` : null,
          },
          select: { id: true },
        });
        partyId = vendor.id;
      }

      if (row.amountCents > 0 && row.asOf) {
        try {
          await setOpeningBalance({ companyId, party: kind, partyId, amountCents: row.amountCents, date: row.asOf, userId });
        } catch (e) {
          outcome.failed.push({
            line: row.line, name: row.name,
            message: `Created, but the opening balance was not posted: ${(e as Error).message}`,
          });
          continue;
        }
      }
      outcome.created.push({ name: row.name, amountCents: row.amountCents });
    } catch (e) {
      outcome.failed.push({ line: row.line, name: row.name, message: (e as Error).message });
    }
  }
  return outcome;
}
