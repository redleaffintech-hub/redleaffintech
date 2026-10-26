/**
 * Depreciation arithmetic — pure functions, no database, so the monthly run, the
 * preview and the continuity schedule all apply exactly the same rules.
 *
 *   STRAIGHT_LINE      (cost - residual) / useful-life months, every month
 *   DECLINING_BALANCE  net book value x annual rate / 12, never below residual
 *
 * Both pro-rate the FIRST month by days in service (an asset placed in service on
 * the 16th of a 30-day month takes 15/30 of a month's charge) and both stop the
 * moment accumulated depreciation reaches cost less residual, so the final charge
 * is whatever remains rather than a rounded figure that overshoots.
 */

export interface DepreciableAsset {
  costCents: number;
  residualCents: number;
  method: string;
  usefulLifeMonths: number;
  /** Annual rate for DECLINING_BALANCE in this app's rateMicro convention (percent x 10_000: 30% = 300_000). */
  decliningRateMicro: number;
  inServiceDate: Date;
  openingAccumulatedCents: number;
  openingAsOf: Date | null;
}

const utc = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d));

export function monthEnd(date: Date): Date {
  return utc(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
}

/** Last day of each month from `from`'s month through `to`'s month. */
export function monthEndsBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth();
  const last = monthEnd(to).getTime();
  while (utc(y, m + 1, 0).getTime() <= last) {
    out.push(utc(y, m + 1, 0));
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

/** The first day depreciation applies: in-service date, or the day after the migrated opening date. */
export function depreciationStart(asset: Pick<DepreciableAsset, "inServiceDate" | "openingAsOf">): Date {
  if (asset.openingAsOf) {
    const next = new Date(asset.openingAsOf.getTime() + 86_400_000);
    return next > asset.inServiceDate ? next : asset.inServiceDate;
  }
  return asset.inServiceDate;
}

/**
 * The charge for the month ending `periodEnd`, given what has been accumulated
 * (including any migrated opening amount) before that month.
 */
export function monthlyCharge(asset: DepreciableAsset, periodEnd: Date, accumulatedBeforeCents: number): number {
  const base = asset.costCents - asset.residualCents;
  const remaining = base - accumulatedBeforeCents;
  if (base <= 0 || remaining <= 0) return 0;

  const start = depreciationStart(asset);
  const end = monthEnd(periodEnd);
  if (end < monthEnd(start)) return 0;

  let full: number;
  if (asset.method === "DECLINING_BALANCE") {
    const nbv = asset.costCents - accumulatedBeforeCents;
    full = Math.round((nbv * asset.decliningRateMicro) / 1_000_000 / 12);
  } else {
    if (asset.usefulLifeMonths <= 0) return 0;
    full = Math.round(base / asset.usefulLifeMonths);
  }

  // First month: only the days from the start date to month end.
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const daysInMonth = end.getUTCDate();
  const factor = sameMonth ? (daysInMonth - start.getUTCDate() + 1) / daysInMonth : 1;

  return Math.max(0, Math.min(Math.round(full * factor), remaining));
}

/** The next asset number: FA-0001, FA-0002, ... one past the highest in use. */
export function nextAssetNumber(existing: string[]): string {
  const highest = existing.reduce((max, n) => {
    const match = /^FA-(\d+)$/.exec(n);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `FA-${String(highest + 1).padStart(4, "0")}`;
}
