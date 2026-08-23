import "server-only";

import { db } from "@/lib/db";
import { PROVINCES } from "@/lib/enums";
import { SYSTEM_ACCOUNTS as SA } from "@/lib/enums";
import type { TaxCodeTemplate, TaxComponentTemplate } from "@/server/setup/templates";
import { PROVINCIAL_TAX_CODES } from "@/server/setup/templates";
import { FEDERAL_TYPES, PROVINCIAL_TYPES, type FederalType, type ProvincialType } from "@/lib/tax/regional-rate-types";

export { FEDERAL_TYPES, PROVINCIAL_TYPES };
export type { FederalType, ProvincialType };

/**
 * The platform's central GST/HST/PST/QST/RST reference, managed only from
 * /admin/regional-tax-rates.
 *
 * This module has exactly two jobs, and deliberately no others:
 *
 *  1. Resolve which regime is in force for a province as of a date — the
 *     lookup every consumer below shares.
 *  2. Turn that regime into the SAME `TaxCodeTemplate` shape company
 *     provisioning already knows how to materialise into a real, per-company
 *     TaxCode with its own TaxComponent rows.
 *
 * It never touches a company's TaxCode or TaxComponent directly, and it is
 * never consulted at document-posting time. Once a TaxCode exists, its
 * TaxComponent.rateMicro IS the historical fact — that is what
 * `calculateTax()`, invoices, bills, tax summaries and the GST/HST return all
 * read, completely unaware this table exists. Publishing a new regional rate
 * here changes what the NEXT company (or the next "add a provincial tax code"
 * click) gets seeded with; it can never reach backward into what already
 * exists. That boundary is what keeps a platform-wide rate change from ever
 * silently rewriting a posted document.
 */

const PROVINCE_CODES: Set<string> = new Set(PROVINCES.map((p) => p.code));

export interface RegionalTaxRate {
  id: string;
  province: string;
  federalType: string;
  federalRateMicro: number;
  provincialType: string;
  provincialRateMicro: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  createdById: string | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Combined rate, in the same rateMicro convention as every other rate in the app. */
export function combinedRateMicro(rate: Pick<RegionalTaxRate, "federalRateMicro" | "provincialRateMicro">): number {
  return rate.federalRateMicro + rate.provincialRateMicro;
}

/** The regime in force for a province on a given date, or null if none is configured. */
export async function currentRegionalTaxRate(province: string, asOf: Date = new Date()): Promise<RegionalTaxRate | null> {
  return db.regionalTaxRate.findFirst({
    where: {
      province,
      isActive: true,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

/** Full timeline for a province, most recent first — "view rate history". */
export async function regionalTaxRateHistory(province: string): Promise<RegionalTaxRate[]> {
  return db.regionalTaxRate.findMany({ where: { province }, orderBy: { effectiveFrom: "desc" } });
}

// ── Validation ───────────────────────────────────────────────────────────────

const MAX_RATE_MICRO = 100_000_000; // 100%

export interface RegionalRateInput {
  province: string;
  federalType: string;
  federalRateMicro: number;
  provincialType: string;
  provincialRateMicro: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/**
 * Everything about one proposed row that can be checked without touching the
 * database: shape, ranges, and the HST-implies-no-separate-provincial-tax rule.
 */
export function validateRegionalRateShape(input: RegionalRateInput): string | null {
  if (!PROVINCE_CODES.has(input.province)) return "Choose a valid Canadian province or territory.";
  if (!FEDERAL_TYPES.includes(input.federalType as FederalType)) return "Federal tax type must be GST or HST.";
  if (!PROVINCIAL_TYPES.includes(input.provincialType as ProvincialType)) {
    return "Provincial tax type must be PST, QST, RST or None.";
  }
  if (!Number.isFinite(input.federalRateMicro) || input.federalRateMicro < 0 || input.federalRateMicro > MAX_RATE_MICRO) {
    return "The GST/HST rate must be between 0% and 100%.";
  }
  if (
    !Number.isFinite(input.provincialRateMicro) ||
    input.provincialRateMicro < 0 ||
    input.provincialRateMicro > MAX_RATE_MICRO
  ) {
    return "The provincial tax rate must be between 0% and 100%.";
  }
  if (input.provincialType === "NONE" && input.provincialRateMicro !== 0) {
    return "A provincial tax type of None must carry a 0% rate.";
  }
  // HST already blends the provincial portion into one rate — a province
  // cannot be HST and ALSO levy a separate PST/QST/RST on top.
  if (input.federalType === "HST" && input.provincialType !== "NONE") {
    return "An HST province does not have a separate provincial tax — set the provincial type to None.";
  }
  if (Number.isNaN(input.effectiveFrom.getTime())) return "Effective date is required.";
  if (input.effectiveTo) {
    if (Number.isNaN(input.effectiveTo.getTime())) return "Expiry date is not a valid date.";
    if (input.effectiveTo <= input.effectiveFrom) return "The expiry date must be after the effective date.";
  }
  return null;
}

/**
 * The overlap rule: for one province, no two rows' [effectiveFrom, effectiveTo)
 * ranges may intersect. An open-ended row (`effectiveTo: null`) is treated as
 * extending to the end of time for this check.
 */
export async function findOverlappingRate(
  input: Pick<RegionalRateInput, "province" | "effectiveFrom" | "effectiveTo">,
  excludeId?: string,
): Promise<RegionalTaxRate | null> {
  const candidates = await db.regionalTaxRate.findMany({
    where: { province: input.province, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
  });
  const newStart = input.effectiveFrom.getTime();
  const newEnd = input.effectiveTo ? input.effectiveTo.getTime() : Infinity;
  for (const existing of candidates) {
    const existingStart = existing.effectiveFrom.getTime();
    const existingEnd = existing.effectiveTo ? existing.effectiveTo.getTime() : Infinity;
    if (newStart < existingEnd && existingStart < newEnd) return existing;
  }
  return null;
}

// ── Provisioning bridge ─────────────────────────────────────────────────────

const GST_HST_KEYS = { liabilityKey: SA.GST_HST_PAYABLE, recoverableKey: SA.GST_HST_RECOVERABLE };

function federalComponent(rate: RegionalTaxRate): TaxComponentTemplate {
  return {
    name: rate.federalType,
    kind: rate.federalType as "GST" | "HST",
    rateMicro: rate.federalRateMicro,
    isRecoverable: true,
    ...GST_HST_KEYS,
  };
}

function provincialComponent(rate: RegionalTaxRate): TaxComponentTemplate | null {
  if (rate.provincialType === "NONE") return null;
  if (rate.provincialType === "QST") {
    return {
      name: "QST",
      kind: "QST",
      rateMicro: rate.provincialRateMicro,
      isRecoverable: true,
      // QST has been levied on the pre-GST amount since 2013 — same
      // convention the static Quebec template already used.
      compoundOnPrevious: false,
      liabilityKey: SA.QST_PAYABLE,
      recoverableKey: SA.QST_RECOVERABLE,
    };
  }
  // PST and RST: provincial sales tax is not recoverable by the purchaser.
  return {
    name: rate.provincialType,
    kind: rate.provincialType as "PST" | "RST",
    rateMicro: rate.provincialRateMicro,
    isRecoverable: false,
    liabilityKey: SA.PST_PAYABLE,
  };
}

function templateFromRegionalRate(province: string, rate: RegionalTaxRate): TaxCodeTemplate {
  const rateLabel = (micro: number) => {
    const pct = micro / 10_000;
    return Number.isInteger(pct) ? String(pct) : pct.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  };
  const provincial = provincialComponent(rate);
  const codeSuffix = rate.federalType === "HST" ? "HST" : `GST-${rate.provincialType}`;
  const nameParts = [`${rate.federalType} ${rateLabel(rate.federalRateMicro)}%`];
  if (provincial) nameParts.push(`${rate.provincialType} ${rateLabel(rate.provincialRateMicro)}%`);
  const provinceName = PROVINCES.find((p) => p.code === province)?.name ?? province;

  return {
    code: `${codeSuffix}-${province}`,
    name: `${nameParts.join(" + ")} (${provinceName})`,
    jurisdiction: province,
    effectiveFrom: rate.effectiveFrom.toISOString().slice(0, 10),
    components: [federalComponent(rate), ...(provincial ? [provincial] : [])],
  };
}

/**
 * The provincial-tax-code templates for a province, as of a date — the one
 * function `src/server/setup/provision.ts` calls instead of reading the static
 * `PROVINCIAL_TAX_CODES` table directly.
 *
 * A province with `provincialType: "NONE"` and federal type GST (AB, NT, NU,
 * YT) returns an empty list rather than a redundant province-specific "GST 5%"
 * code — the company already gets a plain federal GST code from
 * `BASE_TAX_CODES`, and duplicating it under a province-specific code would
 * just be two codes for the same thing.
 *
 * Falls back to the static template when the platform has no regional rate
 * configured for a province yet (should not happen once seeded, but a missing
 * row must degrade to the old behaviour, not to no tax code at all).
 */
export async function provincialTaxCodeTemplates(province: string, asOf: Date = new Date()): Promise<TaxCodeTemplate[]> {
  const rate = await currentRegionalTaxRate(province, asOf);
  if (!rate) return PROVINCIAL_TAX_CODES[province] ?? [];
  if (rate.federalType === "GST" && rate.provincialType === "NONE") return [];
  return [templateFromRegionalRate(province, rate)];
}
