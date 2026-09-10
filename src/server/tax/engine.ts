/**
 * Canadian sales-tax engine (spec §7).
 *
 * Rates are never hard-coded. Every rate comes from a TaxCode's effective-dated
 * TaxComponent rows, and the rate in force on the *transaction date* is the one
 * applied — so re-reading a 2023 invoice after a rate change still shows the
 * 2023 tax. Posted TaxEntry rows snapshot `rateMicro` for the same reason.
 *
 * Supports: GST, HST, PST/RST, QST (including compounding), zero-rated and
 * exempt codes, tax-inclusive and tax-exclusive pricing, recoverable ITCs and
 * non-recoverable provincial tax.
 */

import { MICRO } from "@/lib/money";

export class TaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxError";
  }
}

export interface TaxComponentSpec {
  id: string;
  name: string;
  kind: string;
  rateMicro: number;
  isRecoverable: boolean;
  compoundOnPrevious: boolean;
  liabilityAccountId: string | null;
  recoverableAccountId: string | null;
  sortOrder: number;
}

export interface TaxCodeSpec {
  id: string;
  code: string;
  name: string;
  jurisdiction: string;
  isZeroRated: boolean;
  isExempt: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  components: TaxComponentSpec[];
}

export interface ComponentTax {
  componentId: string;
  name: string;
  kind: string;
  rateMicro: number;
  isRecoverable: boolean;
  liabilityAccountId: string | null;
  recoverableAccountId: string | null;
  taxableCents: number;
  taxCents: number;
}

export interface TaxResult {
  /** Amount excluding tax — what hits the revenue or expense account. */
  netCents: number;
  /** Total tax across all components. */
  taxCents: number;
  /** Net + tax. */
  totalCents: number;
  components: ComponentTax[];
}

function round(numerator: bigint, denominator: bigint): number {
  const neg = numerator < 0n;
  const n = neg ? -numerator : numerator;
  const q = (n * 2n + denominator) / (denominator * 2n);
  return Number(neg ? -q : q);
}

/**
 * The combined tax factor, in micro units, that a net amount is multiplied by.
 * Handles QST-style compounding where a component is levied on net + prior tax.
 */
function combinedFactorMicro(components: TaxComponentSpec[]): bigint {
  let total = 0n;
  for (const c of components) {
    const base = c.compoundOnPrevious ? MICRO + total : MICRO;
    total += (base * BigInt(c.rateMicro)) / MICRO;
  }
  return total;
}

/**
 * Calculate tax for a single line.
 *
 * @param amountCents  tax-exclusive net when `inclusive` is false, gross when true
 */
export function calculateTax(
  taxCode: TaxCodeSpec | null | undefined,
  amountCents: number,
  inclusive: boolean,
  transactionDate: Date,
): TaxResult {
  const amount = Math.trunc(amountCents);

  if (!taxCode || taxCode.isExempt || taxCode.isZeroRated || taxCode.components.length === 0) {
    return { netCents: amount, taxCents: 0, totalCents: amount, components: [] };
  }

  assertEffective(taxCode, transactionDate);

  const components = [...taxCode.components].sort((a, b) => a.sortOrder - b.sortOrder);

  // Derive the net base. For inclusive pricing we back the tax out of the gross.
  let netCents: number;
  let grossTarget: number | null = null;
  if (inclusive) {
    const factor = combinedFactorMicro(components);
    netCents = round(BigInt(amount) * MICRO, MICRO + factor);
    grossTarget = amount;
  } else {
    netCents = amount;
  }

  // Apply each component against its own base (compound components sit on top).
  const result: ComponentTax[] = [];
  let runningTax = 0;
  for (const c of components) {
    const base = c.compoundOnPrevious ? netCents + runningTax : netCents;
    const taxCents = round(BigInt(base) * BigInt(c.rateMicro), MICRO);
    runningTax += taxCents;
    result.push({
      componentId: c.id,
      name: c.name,
      kind: c.kind,
      rateMicro: c.rateMicro,
      isRecoverable: c.isRecoverable,
      liabilityAccountId: c.liabilityAccountId,
      recoverableAccountId: c.recoverableAccountId,
      taxableCents: base,
      taxCents,
    });
  }

  // Inclusive pricing must reconcile to the penny the user typed. Push any
  // one-cent rounding residue into the largest component.
  if (grossTarget !== null) {
    const residue = grossTarget - (netCents + runningTax);
    if (residue !== 0 && result.length > 0) {
      let largest = 0;
      for (let i = 1; i < result.length; i++) {
        if (Math.abs(result[i].taxCents) > Math.abs(result[largest].taxCents)) largest = i;
      }
      result[largest].taxCents += residue;
      runningTax += residue;
    }
  }

  return {
    netCents,
    taxCents: runningTax,
    totalCents: netCents + runningTax,
    components: result,
  };
}

export function assertEffective(taxCode: TaxCodeSpec, date: Date) {
  if (date < taxCode.effectiveFrom) {
    throw new TaxError(
      `Tax code ${taxCode.code} is not effective until ${taxCode.effectiveFrom.toISOString().slice(0, 10)}.`,
    );
  }
  if (taxCode.effectiveTo && date > taxCode.effectiveTo) {
    throw new TaxError(
      `Tax code ${taxCode.code} expired on ${taxCode.effectiveTo.toISOString().slice(0, 10)}. Choose a current code.`,
    );
  }
}

/**
 * Collapse component tax into the GL postings it produces.
 * Sales tax credits a liability account; purchase tax debits a recoverable
 * (ITC) account when eligible, and is otherwise absorbed into the expense.
 */
export function taxPostings(components: ComponentTax[], direction: "SALE" | "PURCHASE") {
  const byAccount = new Map<string, number>();
  let nonRecoverableCents = 0;

  for (const c of components) {
    if (c.taxCents === 0) continue;
    if (direction === "SALE") {
      if (!c.liabilityAccountId) {
        throw new TaxError(`Tax component ${c.name} has no liability account configured.`);
      }
      byAccount.set(c.liabilityAccountId, (byAccount.get(c.liabilityAccountId) ?? 0) + c.taxCents);
    } else if (c.isRecoverable && c.recoverableAccountId) {
      byAccount.set(c.recoverableAccountId, (byAccount.get(c.recoverableAccountId) ?? 0) + c.taxCents);
    } else {
      // Non-recoverable PST is a real cost — it stays with the expense (§7).
      nonRecoverableCents += c.taxCents;
    }
  }

  return { byAccount, nonRecoverableCents };
}
