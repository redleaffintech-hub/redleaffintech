/**
 * The date-range presets on the Export data screen, matching the choices the
 * accountant already knows from QuickBooks. Pure and client-safe.
 *
 * All arithmetic is on UTC calendar days (the app stores dates as UTC midnight).
 */
export const RANGE_PRESETS = [
  { value: "ALL", label: "All dates" },
  { value: "CUSTOM", label: "Custom" },
  { value: "LAST_CALENDAR_QUARTER", label: "Last calendar quarter" },
  { value: "LAST_FISCAL_QUARTER", label: "Last fiscal quarter" },
  { value: "YTD", label: "This year-to-date" },
  { value: "FISCAL_YTD", label: "This fiscal year-to-date" },
  { value: "LAST_YEAR", label: "Last year" },
  { value: "LAST_FISCAL_YEAR", label: "Last fiscal year" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["value"];

export interface ResolvedRange {
  from: Date;
  to: Date;
  /** True for "All dates": the whole ledger, with no beginning-balance rows. */
  all: boolean;
  /** The line under the report title, in QuickBooks' wording. */
  label: string;
}

const utc = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d));
const lastDayOfMonth = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isPreset(value: string | null | undefined): value is RangePreset {
  return RANGE_PRESETS.some((p) => p.value === value);
}

/** "January 1-October 28, 2026" (same year) or "December 1, 2025-March 31, 2026". */
export function describeRange(from: Date, to: Date): string {
  const f = `${MONTHS[from.getUTCMonth()]} ${from.getUTCDate()}`;
  const t = `${MONTHS[to.getUTCMonth()]} ${to.getUTCDate()}`;
  return from.getUTCFullYear() === to.getUTCFullYear()
    ? `${f}-${t}, ${to.getUTCFullYear()}`
    : `${f}, ${from.getUTCFullYear()}-${t}, ${to.getUTCFullYear()}`;
}

/** Start of the fiscal year containing `d`, as a UTC date. */
function fiscalYearStart(d: Date, startMonth: number): Date {
  const y = d.getUTCMonth() + 1 >= startMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return utc(y, startMonth, 1);
}

/** The three-month block that is `back` quarters before the one containing `d`, in a year starting at `startMonth`. */
function quarterBefore(d: Date, startMonth: number, back: number): { from: Date; to: Date } {
  const fy = fiscalYearStart(d, startMonth);
  const monthsIn = (d.getUTCFullYear() - fy.getUTCFullYear()) * 12 + (d.getUTCMonth() - fy.getUTCMonth());
  const currentQuarterIndex = Math.floor(monthsIn / 3);
  const startOffsetMonths = (currentQuarterIndex - back) * 3;
  const from = utc(fy.getUTCFullYear(), fy.getUTCMonth() + 1 + startOffsetMonths, 1);
  const to = lastDayOfMonth(from.getUTCFullYear(), from.getUTCMonth() + 3);
  return { from, to };
}

export function resolveRange(
  preset: RangePreset,
  opts: { today: Date; fiscalYearStartMonth: number; customFrom?: string | null; customTo?: string | null },
): ResolvedRange {
  const { today } = opts;
  const fsm = Math.min(12, Math.max(1, opts.fiscalYearStartMonth || 1));
  const done = (from: Date, to: Date): ResolvedRange => ({ from, to, all: false, label: describeRange(from, to) });

  switch (preset) {
    case "ALL":
      return { from: utc(1900, 1, 1), to: utc(2999, 12, 31), all: true, label: "All Dates" };
    case "CUSTOM": {
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
      const f = iso.exec(opts.customFrom ?? "");
      const t = iso.exec(opts.customTo ?? "");
      if (!f || !t) throw new Error("Choose a start and end date for a custom range.");
      const from = utc(+f[1], +f[2], +f[3]);
      const to = utc(+t[1], +t[2], +t[3]);
      if (from > to) throw new Error("The start date must be on or before the end date.");
      return done(from, to);
    }
    case "LAST_CALENDAR_QUARTER": {
      const q = quarterBefore(today, 1, 1);
      return done(q.from, q.to);
    }
    case "LAST_FISCAL_QUARTER": {
      const q = quarterBefore(today, fsm, 1);
      return done(q.from, q.to);
    }
    case "YTD":
      return done(utc(today.getUTCFullYear(), 1, 1), today);
    case "FISCAL_YTD":
      return done(fiscalYearStart(today, fsm), today);
    case "LAST_YEAR":
      return done(utc(today.getUTCFullYear() - 1, 1, 1), utc(today.getUTCFullYear() - 1, 12, 31));
    case "LAST_FISCAL_YEAR": {
      const start = fiscalYearStart(today, fsm);
      const from = utc(start.getUTCFullYear() - 1, fsm, 1);
      return done(from, new Date(start.getTime() - 86_400_000));
    }
  }
}
