/**
 * Leave entitlement, pro-rating, accrual, carry-forward and balance arithmetic.
 *
 * Pure functions — no database — so the rules are testable and the admin screen,
 * the employee view and the year-end job all apply exactly the same ones.
 * Entitlement and accrual are *computed* from the policy on every read; only
 * carry-forward and admin adjustments are stored (src/server/hr/leave-policy.ts),
 * which is what makes a duplicate accrual impossible: there is nothing to post twice.
 */

export const DEFAULT_ELIGIBLE_TYPES = ["FULL_TIME", "PART_TIME", "CASUAL", "SEASONAL", "CONTRACT"] as const;

export interface LeavePolicyRules {
  entitlementUnit: string; // WEEKS | DAYS | HOURS
  entitlementAmount: number;
  hoursPerDay: number;
  daysPerWeek: number;
  accrualMethod: string; // FRONT_LOADED | ACCRUED
  leaveYearStartMonth: number; // 1-12
  eligibleEmployeeTypes: string; // comma separated
  waitingPeriodDays: number;
  prorationMethod: string; // DAYS | MONTHS | NONE
  carryForwardEnabled: boolean;
  carryForwardMaxHours: number | null;
  carryForwardExpiryMonths: number | null;
  excessHandling: string; // FORFEIT | PAYOUT
}

export interface LeaveEmployeeFacts {
  hireDate: Date;
  employeeType: string;
  terminationDate?: Date | null;
}

export interface LeaveLedgerRow {
  kind: string; // ADJUSTMENT | CARRY_FORWARD | EXPIRY | FORFEIT
  hours: number;
  effectiveDate: Date;
  leaveYear: number | null;
  expiresOn: Date | null;
}

export interface LeaveRequestRow {
  status: string;
  hours: number;
  startDate: Date;
}

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const daysBetween = (a: Date, b: Date) => Math.round((utcDay(b).getTime() - utcDay(a).getTime()) / DAY_MS);
const addDays = (d: Date, n: number) => new Date(utcDay(d).getTime() + n * DAY_MS);

function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear() + Math.floor((d.getUTCMonth() + months) / 12);
  const m = (((d.getUTCMonth() + months) % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return new Date(Date.UTC(y, m, day));
}

/** The leave year is named for the calendar year it STARTS in. */
export function leaveYearStart(year: number, startMonth: number): Date {
  return new Date(Date.UTC(year, startMonth - 1, 1));
}
export function leaveYearEnd(year: number, startMonth: number): Date {
  return addDays(leaveYearStart(year + 1, startMonth), -1);
}
export function leaveYearOf(date: Date, startMonth: number): number {
  const y = date.getUTCFullYear();
  return utcDay(date) < leaveYearStart(y, startMonth) ? y - 1 : y;
}

/** Annual entitlement, in hours, for the policy's unit. */
export function annualEntitlementHours(policy: LeavePolicyRules): number {
  switch (policy.entitlementUnit) {
    case "WEEKS":
      return round2(policy.entitlementAmount * policy.daysPerWeek * policy.hoursPerDay);
    case "DAYS":
      return round2(policy.entitlementAmount * policy.hoursPerDay);
    default:
      return round2(policy.entitlementAmount);
  }
}

export function isEligibleType(policy: LeavePolicyRules, employeeType: string): boolean {
  return policy.eligibleEmployeeTypes.split(",").map((t) => t.trim()).filter(Boolean).includes(employeeType);
}

/** First day the employee is covered by the policy: hire date plus the waiting period. */
export function eligibilityStart(policy: LeavePolicyRules, hireDate: Date): Date {
  return addDays(hireDate, policy.waitingPeriodDays);
}

export interface Entitlement {
  eligible: boolean;
  annualHours: number;
  /** After pro-rating for a mid-year start (equals annualHours for a full year). */
  proratedHours: number;
  /** First day entitlement applies in this leave year. */
  coverageStart: Date | null;
  /** Human-readable working, shown next to the number. */
  explanation: string;
}

/** The employee's entitlement for one leave year, pro-rated for a mid-year joiner. */
export function entitlementForYear(policy: LeavePolicyRules, employee: LeaveEmployeeFacts, year: number): Entitlement {
  const annualHours = annualEntitlementHours(policy);
  const yearStart = leaveYearStart(year, policy.leaveYearStartMonth);
  const yearEnd = leaveYearEnd(year, policy.leaveYearStartMonth);

  if (!isEligibleType(policy, employee.employeeType)) {
    return { eligible: false, annualHours, proratedHours: 0, coverageStart: null, explanation: `${employee.employeeType.replace(/_/g, " ").toLowerCase()} employees are not covered by this policy.` };
  }

  const eligStart = eligibilityStart(policy, employee.hireDate);
  // Leaving mid-year also shortens the entitlement window.
  const lastDay = employee.terminationDate && employee.terminationDate < yearEnd ? utcDay(employee.terminationDate) : yearEnd;
  const start = eligStart > yearStart ? eligStart : yearStart;
  if (start > lastDay) {
    return { eligible: false, annualHours, proratedHours: 0, coverageStart: null, explanation: eligStart > yearEnd ? `Eligible from ${isoDay(eligStart)} (hire date + ${policy.waitingPeriodDays}-day waiting period).` : "Employment ended before any entitlement applied this year." };
  }

  const totalDays = daysBetween(yearStart, yearEnd) + 1;
  const coveredDays = daysBetween(start, lastDay) + 1;
  const fullYear = start.getTime() === yearStart.getTime() && lastDay.getTime() === yearEnd.getTime();

  if (fullYear || policy.prorationMethod === "NONE") {
    return {
      eligible: true, annualHours, proratedHours: annualHours, coverageStart: start,
      explanation: fullYear ? "Full leave year — no pro-rating." : "Pro-rating is turned off, so the full entitlement applies.",
    };
  }

  if (policy.prorationMethod === "MONTHS") {
    // Whole calendar months covered: the start month counts only when coverage begins on its 1st.
    let months = 0;
    for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); cursor <= lastDay; cursor = addMonths(cursor, 1)) {
      const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
      const coveredFrom = start > cursor ? start : cursor;
      const coveredTo = lastDay < monthEnd ? lastDay : monthEnd;
      if (coveredFrom.getTime() === cursor.getTime() && coveredTo.getTime() === monthEnd.getTime()) months++;
    }
    const hours = round2((annualHours * months) / 12);
    return { eligible: true, annualHours, proratedHours: hours, coverageStart: start, explanation: `${months} of 12 full months from ${isoDay(start)} × ${annualHours}h = ${hours}h.` };
  }

  const hours = round2((annualHours * coveredDays) / totalDays);
  return { eligible: true, annualHours, proratedHours: hours, coverageStart: start, explanation: `${coveredDays} of ${totalDays} days from ${isoDay(start)} × ${annualHours}h = ${hours}h.` };
}

/** Hours made available by `asOf`: everything up front, or earned evenly day by day. */
export function allocatedToDate(policy: LeavePolicyRules, entitlement: Entitlement, year: number, asOf: Date): number {
  if (!entitlement.eligible || !entitlement.coverageStart) return 0;
  const day = utcDay(asOf);
  if (day < entitlement.coverageStart) return 0;
  if (policy.accrualMethod !== "ACCRUED") return entitlement.proratedHours;

  const yearStart = leaveYearStart(year, policy.leaveYearStartMonth);
  const yearEnd = leaveYearEnd(year, policy.leaveYearStartMonth);
  const totalDays = daysBetween(yearStart, yearEnd) + 1;
  const until = day < yearEnd ? day : yearEnd;
  const accrued = round2((entitlement.annualHours * (daysBetween(entitlement.coverageStart, until) + 1)) / totalDays);
  return Math.min(accrued, entitlement.proratedHours);
}

export interface LeaveTracker {
  year: number;
  yearStart: Date;
  yearEnd: Date;
  entitlement: Entitlement;
  allocatedHours: number;
  carriedForwardHours: number;
  carryExpiresOn: Date | null;
  expiredHours: number;
  adjustmentHours: number;
  usedHours: number;
  pendingHours: number;
  remainingHours: number;
  /** Remaining minus what is already waiting for approval. */
  availableHours: number;
}

/** One employee's balance for one leave type and leave year, as of a date. */
export function computeTracker(
  policy: LeavePolicyRules,
  employee: LeaveEmployeeFacts,
  year: number,
  asOf: Date,
  ledger: LeaveLedgerRow[],
  requests: LeaveRequestRow[],
): LeaveTracker {
  const yearStart = leaveYearStart(year, policy.leaveYearStartMonth);
  const yearEnd = leaveYearEnd(year, policy.leaveYearStartMonth);
  const entitlement = entitlementForYear(policy, employee, year);
  const allocatedHours = allocatedToDate(policy, entitlement, year, asOf);

  const carry = ledger.filter((r) => r.kind === "CARRY_FORWARD" && r.leaveYear === year);
  const carriedForwardHours = round2(carry.reduce((s, r) => s + r.hours, 0));
  const carryExpiresOn = carry.map((r) => r.expiresOn).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const adjustmentHours = round2(
    ledger
      .filter((r) => r.kind === "ADJUSTMENT" && r.effectiveDate >= yearStart && r.effectiveDate <= yearEnd && utcDay(r.effectiveDate) <= utcDay(asOf))
      .reduce((s, r) => s + r.hours, 0),
  );

  const inYear = (r: LeaveRequestRow) => r.startDate >= yearStart && r.startDate <= yearEnd;
  const usedHours = round2(requests.filter((r) => r.status === "APPROVED" && inYear(r)).reduce((s, r) => s + r.hours, 0));
  const pendingHours = round2(requests.filter((r) => r.status === "PENDING" && inYear(r)).reduce((s, r) => s + r.hours, 0));

  // Carried-forward hours are used first, so what expires is what was not used by the expiry date.
  let expiredHours = 0;
  if (carriedForwardHours > 0 && carryExpiresOn && utcDay(asOf) >= carryExpiresOn) {
    const usedBeforeExpiry = requests
      .filter((r) => r.status === "APPROVED" && inYear(r) && r.startDate < carryExpiresOn)
      .reduce((s, r) => s + r.hours, 0);
    expiredHours = round2(Math.max(0, carriedForwardHours - usedBeforeExpiry));
  }

  const remainingHours = round2(allocatedHours + carriedForwardHours + adjustmentHours - usedHours - expiredHours);
  return {
    year, yearStart, yearEnd, entitlement, allocatedHours, carriedForwardHours, carryExpiresOn, expiredHours,
    adjustmentHours, usedHours, pendingHours, remainingHours, availableHours: round2(remainingHours - pendingHours),
  };
}

export interface CarryForwardResult {
  closingHours: number;
  carriedHours: number;
  /** Hours above the cap (or all of them when carry-forward is off). */
  excessHours: number;
  expiresOn: Date | null;
}

/** What rolls from `closing` (a year-end balance) into the year starting `nextYearStart`. */
export function carryForwardFor(policy: LeavePolicyRules, closingHours: number, nextYear: number): CarryForwardResult {
  const closing = Math.max(0, round2(closingHours));
  const nextStart = leaveYearStart(nextYear, policy.leaveYearStartMonth);
  if (!policy.carryForwardEnabled) return { closingHours: closing, carriedHours: 0, excessHours: closing, expiresOn: null };

  const cap = policy.carryForwardMaxHours ?? Infinity;
  const carried = round2(Math.min(closing, cap));
  return {
    closingHours: closing,
    carriedHours: carried,
    excessHours: round2(closing - carried),
    expiresOn: policy.carryForwardExpiryMonths ? addMonths(nextStart, policy.carryForwardExpiryMonths) : null,
  };
}

function isoDay(d: Date): string {
  return utcDay(d).toISOString().slice(0, 10);
}
