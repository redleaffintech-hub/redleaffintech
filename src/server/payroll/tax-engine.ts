import "server-only";

import { db } from "@/lib/db";
import { PAY_FREQUENCY_PERIODS_PER_YEAR, type PayFrequency } from "@/lib/hr-enums";

/**
 * CPP/CPP2/EI and federal/provincial income tax, computed from the
 * platform-wide, effective-dated PayrollStatutoryRate and PayrollTaxBracket
 * reference tables (see prisma/schema.prisma for the two models' comments —
 * they mirror RegionalTaxRate's "reference table, never posted to directly"
 * shape exactly).
 *
 * Every function here returns a SUGGESTION. Nothing in this module writes to
 * a PayRunLine — src/server/payroll/pay-runs.ts decides when to call this and
 * always leaves the result in a plain editable field, per this app's rule of
 * never locking a computed value away from the bookkeeper who has to answer
 * for it.
 *
 * The income-tax calculation is the standard "annualize, subtract the basic
 * personal amount, apply marginal brackets, divide back by pay periods"
 * method payroll software uses — it is an approximation of the CRA's full
 * T4127 method (no claim codes, no non-refundable credits beyond the basic
 * personal amount). Treat it the same way employment-standards.ts treats its
 * reference tables: a sensible starting point, not a substitute for a
 * payroll professional or CRA's own PDOC tool.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CPP / CPP2 / EI
// ─────────────────────────────────────────────────────────────────────────────

export interface PayrollStatutoryRateRow {
  id: string;
  cppRateMicro: number;
  cppBasicExemptionCents: number;
  cppMaxPensionableEarningsCents: number;
  cpp2RateMicro: number;
  cpp2MaxPensionableEarningsCents: number;
  eiRateMicro: number;
  eiEmployerMultiplierMicro: number;
  eiMaxInsurableEarningsCents: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** The CPP/CPP2/EI parameters in force on a given date, or null if none is configured. */
export async function currentPayrollStatutoryRate(asOf: Date = new Date()): Promise<PayrollStatutoryRateRow | null> {
  return db.payrollStatutoryRate.findFirst({
    where: {
      isActive: true,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

/** For one province, no two rows' [effectiveFrom, effectiveTo) ranges may intersect. */
export async function findOverlappingStatutoryRate(
  input: { effectiveFrom: Date; effectiveTo: Date | null },
  excludeId?: string,
): Promise<PayrollStatutoryRateRow | null> {
  const candidates = await db.payrollStatutoryRate.findMany({
    where: excludeId ? { NOT: { id: excludeId } } : {},
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

export interface CppEiInput {
  grossPayCents: number;
  payFrequency: PayFrequency;
  /** Pensionable/insurable earnings already paid this employee earlier in the same calendar year, before this pay run. */
  ytdPensionableEarningsCents: number;
  ytdCppCents: number;
  ytdCpp2Cents: number;
  ytdInsurableEarningsCents: number;
  ytdEiCents: number;
  rates: PayrollStatutoryRateRow;
}

export interface CppEiResult {
  cppCents: number;
  cpp2Cents: number;
  employerCppCents: number;
  employerCpp2Cents: number;
  eiCents: number;
  employerEiCents: number;
}

/** rateMicro convention throughout this app: value * 1_000_000. */
function applyRateMicro(cents: number, rateMicro: number): number {
  return Math.round((cents * rateMicro) / 1_000_000);
}

/**
 * CPP, CPP2 and EI for one pay period, capped so the employee's cumulative
 * year-to-date contribution never exceeds the annual maximum — the same
 * "stop deducting once the cap is hit" behaviour CRA's own payroll deductions
 * table produces.
 */
export function computeCppAndEi(input: CppEiInput): CppEiResult {
  const { rates } = input;
  const periodsPerYear = PAY_FREQUENCY_PERIODS_PER_YEAR[input.payFrequency] ?? 26;

  // CPP (base tier): per-period basic exemption, pensionable earnings above
  // it, capped at the annual maximum contribution.
  const perPeriodExemption = rates.cppBasicExemptionCents / periodsPerYear;
  const pensionableEarnings = Math.max(0, input.grossPayCents - perPeriodExemption);
  const maxAnnualCpp = applyRateMicro(
    rates.cppMaxPensionableEarningsCents - rates.cppBasicExemptionCents,
    rates.cppRateMicro,
  );
  const rawCpp = applyRateMicro(pensionableEarnings, rates.cppRateMicro);
  const cppCents = Math.max(0, Math.min(rawCpp, maxAnnualCpp - input.ytdCppCents));

  // CPP2 (second tier): applies only to pensionable earnings between the
  // regular YMPE and the additional YAMPE ceiling.
  const cpp2Band = Math.max(
    0,
    Math.min(input.grossPayCents, rates.cpp2MaxPensionableEarningsCents) - rates.cppMaxPensionableEarningsCents,
  );
  const maxAnnualCpp2 = applyRateMicro(
    rates.cpp2MaxPensionableEarningsCents - rates.cppMaxPensionableEarningsCents,
    rates.cpp2RateMicro,
  );
  const rawCpp2 = applyRateMicro(Math.max(0, cpp2Band), rates.cpp2RateMicro);
  const cpp2Cents = Math.max(0, Math.min(rawCpp2, maxAnnualCpp2 - input.ytdCpp2Cents));

  // EI: capped at the annual maximum insurable earnings.
  const insurableEarnings = Math.max(
    0,
    Math.min(input.grossPayCents, rates.eiMaxInsurableEarningsCents - input.ytdInsurableEarningsCents),
  );
  const maxAnnualEi = applyRateMicro(rates.eiMaxInsurableEarningsCents, rates.eiRateMicro);
  const rawEi = applyRateMicro(insurableEarnings, rates.eiRateMicro);
  const eiCents = Math.max(0, Math.min(rawEi, maxAnnualEi - input.ytdEiCents));

  return {
    cppCents,
    cpp2Cents,
    employerCppCents: cppCents,
    employerCpp2Cents: cpp2Cents,
    eiCents,
    employerEiCents: applyRateMicro(eiCents, rates.eiEmployerMultiplierMicro),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Federal / provincial income tax — marginal brackets
// ─────────────────────────────────────────────────────────────────────────────

export interface PayrollTaxBracketRow {
  id: string;
  jurisdiction: string;
  minCents: number;
  maxCents: number | null;
  rateMicro: number;
  basicPersonalAmountCents: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** The bracket set in force for a jurisdiction on a date, ordered lowest bracket first. */
export async function currentTaxBrackets(jurisdiction: string, asOf: Date = new Date()): Promise<PayrollTaxBracketRow[]> {
  // All brackets for a jurisdiction/year share the same effectiveFrom, so the
  // one query below already returns exactly one year's worth per jurisdiction.
  return db.payrollTaxBracket.findMany({
    where: {
      jurisdiction,
      isActive: true,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    },
    orderBy: { minCents: "asc" },
  });
}

export async function findOverlappingBracket(
  input: { jurisdiction: string; effectiveFrom: Date; effectiveTo: Date | null },
  excludeId?: string,
): Promise<PayrollTaxBracketRow | null> {
  const candidates = await db.payrollTaxBracket.findMany({
    where: { jurisdiction: input.jurisdiction, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
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

/**
 * Tax on one year of taxable income, given a jurisdiction's marginal
 * brackets. The basic personal amount is subtracted before brackets apply —
 * a simplification of the CRA's credit-based method, not a claim-code system.
 */
export function annualIncomeTaxCents(annualIncomeCents: number, brackets: PayrollTaxBracketRow[]): number {
  if (brackets.length === 0) return 0;
  const basicPersonalAmountCents = brackets[0].basicPersonalAmountCents;
  const taxableCents = Math.max(0, annualIncomeCents - basicPersonalAmountCents);

  let tax = 0;
  for (const bracket of brackets) {
    if (taxableCents <= bracket.minCents) break;
    const bandTop = bracket.maxCents ?? Infinity;
    const amountInBand = Math.min(taxableCents, bandTop) - bracket.minCents;
    if (amountInBand <= 0) continue;
    tax += applyRateMicro(amountInBand, bracket.rateMicro);
  }
  return Math.round(tax);
}

/**
 * One pay period's federal or provincial tax: annualize this period's gross
 * (periodGross * periodsPerYear), tax the annualized figure, divide back down.
 * The standard periodic-conversion method payroll software uses.
 */
export function periodIncomeTaxCents(
  periodGrossCents: number,
  payFrequency: PayFrequency,
  brackets: PayrollTaxBracketRow[],
): number {
  if (brackets.length === 0) return 0;
  const periodsPerYear = PAY_FREQUENCY_PERIODS_PER_YEAR[payFrequency] ?? 26;
  const annualized = Math.round(periodGrossCents * periodsPerYear);
  const annualTax = annualIncomeTaxCents(annualized, brackets);
  return Math.round(annualTax / periodsPerYear);
}

// ─────────────────────────────────────────────────────────────────────────────
// Overtime pay suggestion
// ─────────────────────────────────────────────────────────────────────────────

export interface EmployeeForOvertime {
  compensationType: string; // SALARY | HOURLY
  payRateCents: number;
  standardHoursPerWeek: number | null;
  defaultOvertimeRateMultiplierMicro: number | null;
}

/**
 * Suggested overtime pay for a number of overtime hours. Hourly employees use
 * their rate directly; salaried employees get an hourly-equivalent derived
 * from their annual salary and standard hours — an approximation the
 * bookkeeper should verify against the employee's actual OT-exemption status,
 * which varies by province and role and is not modelled here.
 */
export function suggestOvertimePayCents(
  employee: EmployeeForOvertime,
  overtimeHours: number,
  multiplierMicroOverride?: number | null,
): number {
  const multiplierMicro = multiplierMicroOverride ?? employee.defaultOvertimeRateMultiplierMicro;
  if (!multiplierMicro || overtimeHours <= 0) return 0;

  const hourlyRateCents =
    employee.compensationType === "HOURLY"
      ? employee.payRateCents
      : employee.payRateCents / ((employee.standardHoursPerWeek || 40) * 52);

  return Math.round(hourlyRateCents * overtimeHours * (multiplierMicro / 1_000_000));
}
