/**
 * All accounting dates are stored as UTC midnight. Financial periods must not
 * shift because a user is in Vancouver and the server is in Toronto, so every
 * date helper here works purely in UTC and never uses the local timezone.
 */

export function utcDate(year: number, month1: number, day: number): Date {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** Strip time; "2026-03-14T22:10:00-04:00" -> 2026-03-14T00:00:00Z */
export function toUtcDay(value: Date | string): Date {
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
    const parsed = new Date(value);
    return utcDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
  }
  return utcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

export function today(): Date {
  return toUtcDay(new Date());
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const targetMonth = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(targetMonth);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function startOfMonth(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** ISO yyyy-mm-dd — the value format for <input type="date">. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const SHORT = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MEDIUM = new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-CA", { month: "short", year: "2-digit", timeZone: "UTC" });
const MONTH_LONG = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return SHORT.format(typeof date === "string" ? new Date(date) : date);
}
export function formatDateLong(date: Date | string): string {
  return MEDIUM.format(typeof date === "string" ? new Date(date) : date);
}
export function formatMonth(date: Date): string {
  return MONTH.format(date);
}
export function formatMonthLong(date: Date): string {
  return MONTH_LONG.format(date);
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function relativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(d);
}

/** The fiscal year a date belongs to, given the company's FY start month. */
export function fiscalYearOf(date: Date, fiscalYearStartMonth: number): number {
  const month = date.getUTCMonth() + 1;
  return month >= fiscalYearStartMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

export function fiscalYearRange(fiscalYear: number, fiscalYearStartMonth: number) {
  const start = utcDate(fiscalYear, fiscalYearStartMonth, 1);
  const end = addDays(addMonths(start, 12), -1);
  return { start, end };
}

/** Inclusive list of month starts between two dates. */
export function monthsBetween(start: Date, end: Date): Date[] {
  const months: Date[] = [];
  let cursor = startOfMonth(start);
  const last = startOfMonth(end);
  while (cursor <= last) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

/**
 * Turn `from`/`to` search params into a Prisma date filter, or undefined when
 * neither is set.
 *
 * Dates are stored as UTC days and `to` is inclusive — a range ending on the
 * 31st must include documents dated the 31st, so it is compared against the end
 * of that day rather than its start.
 */
export function dateRangeWhere(from: unknown, to: unknown) {
  const isDay = (value: unknown): value is string =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  const filter: { gte?: Date; lte?: Date } = {};
  if (isDay(from)) filter.gte = new Date(`${from}T00:00:00.000Z`);
  if (isDay(to)) filter.lte = new Date(`${to}T23:59:59.999Z`);
  return Object.keys(filter).length > 0 ? filter : undefined;
}
