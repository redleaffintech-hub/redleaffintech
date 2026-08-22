/**
 * Money & rate arithmetic.
 *
 * Spec §5.1: "Use NUMERIC/DECIMAL for monetary values; never floating point."
 * Every amount in this system is an integer count of cents. Nothing in the
 * accounting path is ever a JS float, so 0.1 + 0.2 problems cannot occur.
 *
 * Rates are `micro` integers: rate * 1_000_000. 13% -> 130_000.
 * Quantities are `milli` integers: qty * 1_000. 7.5h -> 7_500.
 */

export const MICRO = 1_000_000n;
export const MILLI = 1_000n;

/** Round-half-away-from-zero on a BigInt division. CRA rounds half up. */
function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Division by zero in money math");
  const neg = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return neg ? -q : q;
}

/** cents * rateMicro, rounded to the nearest cent. */
export function applyRate(cents: number, rateMicro: number): number {
  return Number(divRound(BigInt(Math.trunc(cents)) * BigInt(Math.trunc(rateMicro)), MICRO));
}

/** quantityMilli * unitPriceCents, rounded to the nearest cent. */
export function extendLine(quantityMilli: number, unitPriceCents: number): number {
  return Number(divRound(BigInt(Math.trunc(quantityMilli)) * BigInt(Math.trunc(unitPriceCents)), MILLI));
}

/** Percentage discount off a gross line amount. */
export function applyDiscount(cents: number, discountPercentMicro: number): number {
  if (!discountPercentMicro) return 0;
  return applyRate(cents, discountPercentMicro / 100);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

// ── Parsing & formatting ────────────────────────────────────────────────────

/** "1,234.56" | 1234.56 -> 123456 cents. Rejects anything non-numeric. */
export function toCents(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  const raw = typeof input === "number" ? String(input) : input.replace(/[$,\s]/g, "");
  if (!/^-?\d*\.?\d*$/.test(raw)) throw new Error(`Not a valid amount: ${input}`);
  const negative = raw.startsWith("-");
  const [whole, frac = ""] = raw.replace("-", "").split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2).padEnd(2, "0"));
  const rounded = frac.length > 2 && Number(frac[2]) >= 5 ? cents + 1n : cents;
  return Number(negative ? -rounded : rounded);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

const CAD = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  currencyDisplay: "narrowSymbol",
});
const PLAIN = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** $1,234.56 — negatives in parentheses, the accounting convention. */
export function formatMoney(
  cents: number,
  opts: { showCurrency?: boolean; accountingNegative?: boolean; blankZero?: boolean } = {},
): string {
  const { showCurrency = true, accountingNegative = false, blankZero = false } = opts;
  if (blankZero && cents === 0) return "—";
  const fmt = showCurrency ? CAD : PLAIN;
  if (accountingNegative && cents < 0) return `(${fmt.format(Math.abs(cents) / 100)})`;
  return fmt.format(cents / 100);
}

/** Compact form for KPI tiles: $1.2M, $84.3K, $912 */
export function formatCompact(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}$${(abs / 100_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 100_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs / 100).toLocaleString("en-CA")}`;
}

export function formatRate(rateMicro: number): string {
  const pct = rateMicro / 10_000;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(3).replace(/0+$/, "")}%`;
}

export function formatQty(quantityMilli: number): string {
  const q = quantityMilli / 1000;
  return Number.isInteger(q) ? String(q) : q.toFixed(2);
}
