/**
 * Canadian employment-standards reference data.
 *
 * This module is deliberately NOT wired into any calculation that moves money —
 * there is no payroll engine yet (see `src/server/tax/regional-rates.ts` for the
 * equivalent boundary on the tax side). What it provides is reference
 * information surfaced on an employee's profile: the *structural* rules
 * (tiered vacation entitlement, tiered termination notice, which statutory
 * holidays apply) are stable and well documented across provincial employment
 * standards acts. The one thing that is NOT stable — the dollar minimum-wage
 * figure, which most provinces revise annually — is clearly dated and flagged
 * as a snapshot rather than presented as current fact.
 *
 * None of this is legal advice. It exists so a small business gets a sensible,
 * source-cited starting point instead of nothing, not so it can skip talking to
 * a payroll professional or an employment lawyer.
 *
 * Every table below covers all 13 provinces/territories for the *provincially
 * regulated* private sector (the vast majority of employers). Federally
 * regulated employers (banks, airlines, telecom, interprovincial transport)
 * follow the Canada Labour Code instead, which is not modelled here.
 */

import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// SIN — validation, masking, and a one-way fingerprint
// ─────────────────────────────────────────────────────────────────────────────

/** Strip everything but digits. `"046 454 286"` -> `"046454286"`. */
export function normalizeSin(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * The CRA's SIN check digit is a standard Luhn (mod-10) validation: double every
 * second digit from the right, sum the digits of the results, and the total
 * (plus the untouched digits) must be a multiple of 10.
 */
export function isValidSin(raw: string): boolean {
  const digits = normalizeSin(raw);
  if (digits.length !== 9) return false;

  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i]);
    // Positions 2, 4, 6, 8 counting from the left (1-indexed) are doubled —
    // equivalently, every second digit from the right.
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** `"046454286"` -> `"••• ••• 286"` — the only form of a SIN ever sent to the browser. */
export function maskSin(lastThree: string): string {
  return `••• ••• ${lastThree}`;
}

export function sinLastThree(raw: string): string {
  return normalizeSin(raw).slice(-3);
}

// ─────────────────────────────────────────────────────────────────────────────
// Years of service
// ─────────────────────────────────────────────────────────────────────────────

/** Completed years between two dates — the unit every tiered table below keys off. */
export function completedYears(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversaryPassed =
    to.getUTCMonth() > from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() >= from.getUTCDate());
  if (!anniversaryPassed) years -= 1;
  return Math.max(0, years);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vacation entitlement (minimum standard, private sector, non-unionized)
// ─────────────────────────────────────────────────────────────────────────────

interface VacationTier {
  minYears: number;
  weeks: number;
  /** rate * 1_000_000, matching this app's rateMicro convention everywhere else. */
  percentMicro: number;
}

/** Tiers listed ascending by minYears; the highest tier the employee has reached applies. */
const VACATION_TIERS: Record<string, VacationTier[]> = {
  AB: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 5, weeks: 3, percentMicro: 6_000_000 }],
  BC: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 5, weeks: 3, percentMicro: 6_000_000 }],
  MB: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 5, weeks: 3, percentMicro: 6_000_000 }],
  NB: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 8, weeks: 3, percentMicro: 6_000_000 }],
  NL: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 15, weeks: 3, percentMicro: 6_000_000 }],
  NS: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 8, weeks: 3, percentMicro: 6_000_000 }],
  NT: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 5, weeks: 3, percentMicro: 6_000_000 }],
  NU: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 5, weeks: 3, percentMicro: 6_000_000 }],
  ON: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 5, weeks: 3, percentMicro: 6_000_000 }],
  PE: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 8, weeks: 3, percentMicro: 6_000_000 }],
  QC: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }, { minYears: 3, weeks: 3, percentMicro: 6_000_000 }],
  SK: [{ minYears: 0, weeks: 3, percentMicro: 6_000_000 }, { minYears: 10, weeks: 4, percentMicro: 8_000_000 }],
  YT: [{ minYears: 0, weeks: 2, percentMicro: 4_000_000 }],
};

export interface VacationEntitlement {
  weeks: number;
  percentMicro: number;
}

/** The minimum vacation entitlement for a province at a given tenure. Reference only — a company may offer more. */
export function vacationEntitlement(province: string, yearsOfService: number): VacationEntitlement | null {
  const tiers = VACATION_TIERS[province];
  if (!tiers) return null;
  let applicable = tiers[0];
  for (const tier of tiers) {
    if (yearsOfService >= tier.minYears) applicable = tier;
  }
  return { weeks: applicable.weeks, percentMicro: applicable.percentMicro };
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimum wage — a dated SNAPSHOT, not a live feed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * General adult minimum hourly wage, in cents. Most provinces revise this every
 * October or April; several index it to inflation. This table is a snapshot as
 * of this codebase's knowledge cutoff and WILL drift — every consumer of it must
 * show `MINIMUM_WAGE_AS_OF` next to the figure rather than presenting it bare.
 */
export const MINIMUM_WAGE_AS_OF = "2026-01";

export const MINIMUM_WAGE_CENTS: Record<string, number> = {
  AB: 1500,
  BC: 1740,
  MB: 1580,
  NB: 1530,
  NL: 1560,
  NS: 1570,
  NT: 1670,
  NU: 1900,
  ON: 1720,
  PE: 1600,
  QC: 1610,
  SK: 1500,
  YT: 1794,
};

// ─────────────────────────────────────────────────────────────────────────────
// Minimum individual termination notice (non-unionized, no cause)
// ─────────────────────────────────────────────────────────────────────────────

interface NoticeTier {
  minYears: number;
  weeks: number;
}

/**
 * Weeks of written notice (or pay in lieu), by completed years of service. The
 * three largest provinces have well-documented explicit tables; the remainder
 * follow the same general "roughly one week per year, capped" shape their acts
 * describe — verify the exact figure for a province before relying on it.
 */
const NOTICE_TIERS: Record<string, NoticeTier[]> = {
  ON: [
    { minYears: 0, weeks: 0 }, { minYears: 0.25, weeks: 1 }, { minYears: 1, weeks: 2 },
    { minYears: 3, weeks: 3 }, { minYears: 4, weeks: 4 }, { minYears: 5, weeks: 5 },
    { minYears: 6, weeks: 6 }, { minYears: 7, weeks: 7 }, { minYears: 8, weeks: 8 },
  ],
  BC: [
    { minYears: 0, weeks: 0 }, { minYears: 0.25, weeks: 1 }, { minYears: 1, weeks: 2 },
    { minYears: 3, weeks: 3 }, { minYears: 4, weeks: 4 }, { minYears: 5, weeks: 5 },
    { minYears: 6, weeks: 6 }, { minYears: 7, weeks: 7 }, { minYears: 8, weeks: 8 },
  ],
  AB: [
    { minYears: 0, weeks: 0 }, { minYears: 0.25, weeks: 1 }, { minYears: 2, weeks: 2 },
    { minYears: 4, weeks: 4 }, { minYears: 6, weeks: 5 }, { minYears: 8, weeks: 6 },
    { minYears: 10, weeks: 8 },
  ],
  // The rest use a common ESA-style shape (1 week per year after a short
  // qualifying period, capped at 8) pending a province-by-province review.
  DEFAULT: [
    { minYears: 0, weeks: 0 }, { minYears: 0.25, weeks: 1 }, { minYears: 1, weeks: 2 },
    { minYears: 2, weeks: 3 }, { minYears: 3, weeks: 4 }, { minYears: 4, weeks: 5 },
    { minYears: 5, weeks: 6 }, { minYears: 6, weeks: 7 }, { minYears: 7, weeks: 8 },
  ],
};

export function minimumTerminationNoticeWeeks(province: string, yearsOfService: number): number {
  const tiers = NOTICE_TIERS[province] ?? NOTICE_TIERS.DEFAULT;
  let applicable = tiers[0];
  for (const tier of tiers) {
    if (yearsOfService >= tier.minYears) applicable = tier;
  }
  return applicable.weeks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Statutory holidays
// ─────────────────────────────────────────────────────────────────────────────

function utcDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for Easter Sunday. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** The nth occurrence (1-indexed) of a weekday (0=Sunday..6=Saturday) in a month. */
function nthWeekdayOfMonth(year: number, month1: number, weekday: number, n: number): Date {
  const first = utcDate(year, month1, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

/** Victoria Day: the Monday on or immediately before May 25. */
function victoriaDay(year: number): Date {
  for (let day = 25; day >= 19; day--) {
    const d = utcDate(year, 5, day);
    if (d.getUTCDay() === 1) return d;
  }
  return utcDate(year, 5, 18); // unreachable, satisfies the type checker
}

export interface StatutoryHoliday {
  date: Date;
  name: string;
}

/**
 * A best-effort statutory holiday calendar. The five national holidays are
 * observed everywhere; the province-specific list covers the well-documented
 * common cases and is not exhaustive — regional/optional holidays some
 * municipalities or industries observe are deliberately left out rather than
 * guessed at.
 */
export function statutoryHolidays(province: string, year: number): StatutoryHoliday[] {
  const easter = easterSunday(year);
  const goodFriday = addDays(easter, -2);
  const thanksgiving = nthWeekdayOfMonth(year, 10, 1, 2); // 2nd Monday of October
  const labourDay = nthWeekdayOfMonth(year, 9, 1, 1); // 1st Monday of September
  const familyDayThirdMonFeb = nthWeekdayOfMonth(year, 2, 1, 3); // 3rd Monday of February

  const national: StatutoryHoliday[] = [
    { date: utcDate(year, 1, 1), name: "New Year's Day" },
    { date: goodFriday, name: "Good Friday" },
    { date: utcDate(year, 7, 1), name: "Canada Day" },
    { date: labourDay, name: "Labour Day" },
    { date: utcDate(year, 12, 25), name: "Christmas Day" },
  ];

  const remembranceDay: StatutoryHoliday = { date: utcDate(year, 11, 11), name: "Remembrance Day" };
  const boxingDay: StatutoryHoliday = { date: utcDate(year, 12, 26), name: "Boxing Day" };

  const byProvince: Record<string, StatutoryHoliday[]> = {
    ON: [
      { date: familyDayThirdMonFeb, name: "Family Day" },
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      boxingDay,
    ],
    BC: [
      { date: familyDayThirdMonFeb, name: "Family Day" },
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: utcDate(year, 9, 30), name: "National Day for Truth and Reconciliation" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
    ],
    AB: [
      { date: familyDayThirdMonFeb, name: "Family Day" },
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
    ],
    SK: [
      { date: familyDayThirdMonFeb, name: "Family Day" },
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
    ],
    MB: [
      { date: familyDayThirdMonFeb, name: "Louis Riel Day" },
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
    ],
    QC: [
      // Same calendar date as Victoria Day (the Monday on or before May 25), under Quebec's own name for it.
      { date: victoriaDay(year), name: "National Patriots' Day" },
      { date: utcDate(year, 6, 24), name: "Saint-Jean-Baptiste Day (Fête nationale)" },
      { date: thanksgiving, name: "Thanksgiving Day" },
    ],
    NB: [
      { date: familyDayThirdMonFeb, name: "Family Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
    ],
    NS: [
      { date: familyDayThirdMonFeb, name: "Nova Scotia Heritage Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
    ],
    PE: [
      { date: familyDayThirdMonFeb, name: "Islander Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
    ],
    NL: [
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
    ],
    YT: [
      { date: victoriaDay(year), name: "Victoria Day" },
      { date: nthWeekdayOfMonth(year, 8, 1, 3), name: "Discovery Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
      boxingDay,
    ],
    NT: [
      { date: utcDate(year, 6, 21), name: "National Indigenous Peoples Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
      boxingDay,
    ],
    NU: [
      { date: utcDate(year, 6, 21), name: "National Indigenous Peoples Day" },
      { date: thanksgiving, name: "Thanksgiving Day" },
      remembranceDay,
      boxingDay,
    ],
  };

  const all = [...national, ...(byProvince[province] ?? [])];
  return all.sort((a, b) => a.date.getTime() - b.date.getTime());
}
