import "server-only";

import { db } from "@/lib/db";
import {
  carryForwardFor,
  computeTracker,
  leaveYearEnd,
  leaveYearOf,
  leaveYearStart,
  type LeaveLedgerRow,
  type LeavePolicyRules,
  type LeaveRequestRow,
  type LeaveTracker,
} from "@/lib/leave-calc";

export interface TrackerRow {
  employeeId: string;
  employeeName: string;
  employeeType: string;
  leaveTypeId: string;
  leaveTypeName: string;
  category: string;
  policy: LeavePolicyRules & { id: string };
  tracker: LeaveTracker;
  asOf: Date;
}

const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

/** The ledger kinds that move a balance. EXPIRY / FORFEIT rows are records only. */
export const BALANCE_KINDS = ["ADJUSTMENT", "CARRY_FORWARD"] as const;

/**
 * Leave trackers for every (active policy x active employee) pair, as of a date.
 * Computed on read from the policy, the ledger and the leave requests — nothing
 * here writes, so reading a balance twice can never change it.
 */
export async function leaveTrackers(
  companyId: string,
  opts: {
    employeeId?: string;
    asOf?: Date;
    /**
     * Pay-stub mode: balance exactly as of `asOf`. Leave that starts after that
     * date is not yet taken, and a terminated employee still gets a figure.
     */
    historical?: boolean;
  } = {},
): Promise<TrackerRow[]> {
  const asOf = opts.asOf ?? todayUtc();

  const [policies, employees] = await Promise.all([
    db.leavePolicy.findMany({
      where: { companyId, isActive: true, leaveType: { isActive: true, trackBalance: true } },
      include: { leaveType: true },
      orderBy: { leaveType: { name: "asc" } },
    }),
    db.employee.findMany({
      where: { companyId, ...(opts.historical ? {} : { employmentStatus: { not: "TERMINATED" } }), ...(opts.employeeId ? { id: opts.employeeId } : {}) },
      orderBy: [{ legalFirstName: "asc" }, { legalLastName: "asc" }],
      select: { id: true, legalFirstName: true, legalLastName: true, employeeType: true, hireDate: true, terminationDate: true },
    }),
  ]);
  if (policies.length === 0 || employees.length === 0) return [];

  const employeeIds = employees.map((e) => e.id);
  const typeIds = policies.map((p) => p.leaveTypeId);
  const [ledgerRows, requests] = await Promise.all([
    db.leaveBalanceAdjustment.findMany({ where: { companyId, employeeId: { in: employeeIds }, leaveTypeId: { in: typeIds } } }),
    db.leaveRequest.findMany({
      where: { companyId, employeeId: { in: employeeIds }, leaveTypeId: { in: typeIds }, status: { in: ["APPROVED", "PENDING"] } },
      select: { employeeId: true, leaveTypeId: true, status: true, hours: true, startDate: true },
    }),
  ]);

  const rows: TrackerRow[] = [];
  for (const employee of employees) {
    for (const policy of policies) {
      const year = leaveYearOf(asOf, policy.leaveYearStartMonth);
      const ledger: LeaveLedgerRow[] = ledgerRows
        .filter((r) => r.employeeId === employee.id && r.leaveTypeId === policy.leaveTypeId)
        .map((r) => ({ kind: r.kind, hours: r.hours, effectiveDate: r.effectiveDate, leaveYear: r.leaveYear, expiresOn: r.expiresOn }));
      const reqs: LeaveRequestRow[] = requests
        .filter((r) => r.employeeId === employee.id && r.leaveTypeId === policy.leaveTypeId)
        .filter((r) => !opts.historical || r.startDate <= asOf)
        .map((r) => ({ status: r.status, hours: r.hours, startDate: r.startDate }));

      rows.push({
        employeeId: employee.id,
        employeeName: `${employee.legalFirstName} ${employee.legalLastName}`,
        employeeType: employee.employeeType,
        leaveTypeId: policy.leaveTypeId,
        leaveTypeName: policy.leaveType.name,
        category: policy.leaveType.category,
        policy,
        // A pay stub reports what has been ACCRUED to the pay date. A policy that grants the whole
        // year up front would otherwise print the full annual entitlement on a January stub.
        tracker: computeTracker(opts.historical ? { ...policy, accrualMethod: "ACCRUED" } : policy, employee, year, asOf, ledger, reqs),
        asOf,
      });
    }
  }
  return rows;
}

/**
 * Idempotent year-end processing. For every active policy and employee, makes
 * sure the CURRENT leave year has its carry-forward entry (computed from the
 * previous year's closing balance and the policy's cap) and that any carried
 * hours that have passed their expiry are recorded as expired.
 *
 * Each entry carries a dedupe key (`CF:employee:type:year`, `EXP:…`, `FOR:…`),
 * so running this on every page load — or twice in a row — never duplicates a
 * balance. Balances themselves never depend on whether it has run: expiry is
 * computed on read, this only writes the audit record.
 *
 * Carry-forward starts the year AFTER a policy is created: before that there is
 * no history to roll over, and assuming "nothing was ever taken" would invent
 * a balance. Opening balances go in as admin adjustments.
 */
export async function syncLeaveLedger(companyId: string, userId?: string | null): Promise<{ carried: number; expired: number }> {
  const asOf = todayUtc();
  const policies = await db.leavePolicy.findMany({
    where: { companyId, isActive: true, leaveType: { isActive: true, trackBalance: true } },
    include: { leaveType: true },
  });
  if (policies.length === 0) return { carried: 0, expired: 0 };

  const employees = await db.employee.findMany({
    where: { companyId, employmentStatus: { not: "TERMINATED" } },
    select: { id: true, employeeType: true, hireDate: true, terminationDate: true },
  });

  let carried = 0;
  let expired = 0;

  for (const policy of policies) {
    const year = leaveYearOf(asOf, policy.leaveYearStartMonth);
    const prevYear = year - 1;
    const policyFirstYear = leaveYearOf(policy.createdAt, policy.leaveYearStartMonth);
    const hasHistory = prevYear >= policyFirstYear;

    const [ledgerRows, requests] = await Promise.all([
      db.leaveBalanceAdjustment.findMany({ where: { companyId, leaveTypeId: policy.leaveTypeId } }),
      db.leaveRequest.findMany({
        where: { companyId, leaveTypeId: policy.leaveTypeId, status: { in: ["APPROVED", "PENDING"] } },
        select: { employeeId: true, status: true, hours: true, startDate: true },
      }),
    ]);

    const toCreate: {
      companyId: string; employeeId: string; leaveTypeId: string; hours: number; reason: string; effectiveDate: Date;
      kind: string; leaveYear: number; expiresOn: Date | null; dedupeKey: string; createdById: string | null;
    }[] = [];

    for (const employee of employees) {
      const mine = ledgerRows.filter((r) => r.employeeId === employee.id);
      const ledger = (rows: typeof mine): LeaveLedgerRow[] =>
        rows.map((r) => ({ kind: r.kind, hours: r.hours, effectiveDate: r.effectiveDate, leaveYear: r.leaveYear, expiresOn: r.expiresOn }));
      const reqs: LeaveRequestRow[] = requests
        .filter((r) => r.employeeId === employee.id)
        .map((r) => ({ status: r.status, hours: r.hours, startDate: r.startDate }));

      // 1. Carry-forward into the current year, from the previous year's closing balance.
      if (hasHistory && employee.hireDate < leaveYearStart(year, policy.leaveYearStartMonth)) {
        const closing = computeTracker(policy, employee, prevYear, leaveYearEnd(prevYear, policy.leaveYearStartMonth), ledger(mine), reqs).remainingHours;
        const result = carryForwardFor(policy, closing, year);
        const yearStart = leaveYearStart(year, policy.leaveYearStartMonth);
        const hasCarry = mine.some((r) => r.dedupeKey === `CF:${employee.id}:${policy.leaveTypeId}:${year}`);
        if (!hasCarry && (result.carriedHours > 0 || result.excessHours > 0)) {
          if (result.carriedHours > 0) {
            toCreate.push({
              companyId, employeeId: employee.id, leaveTypeId: policy.leaveTypeId, hours: result.carriedHours,
              reason: `Carried forward from ${prevYear} (closing balance ${result.closingHours}h${policy.carryForwardMaxHours != null ? `, cap ${policy.carryForwardMaxHours}h` : ""})`,
              effectiveDate: yearStart, kind: "CARRY_FORWARD", leaveYear: year, expiresOn: result.expiresOn,
              dedupeKey: `CF:${employee.id}:${policy.leaveTypeId}:${year}`, createdById: userId ?? null,
            });
            carried++;
          }
          if (result.excessHours > 0) {
            toCreate.push({
              companyId, employeeId: employee.id, leaveTypeId: policy.leaveTypeId, hours: result.excessHours,
              reason: policy.carryForwardEnabled
                ? `Above the ${policy.carryForwardMaxHours}h carry-forward cap — ${policy.excessHandling === "PAYOUT" ? "to be paid out" : "forfeited"} per policy`
                : `Carry-forward is off — unused ${prevYear} balance ${policy.excessHandling === "PAYOUT" ? "to be paid out" : "forfeited"} per policy`,
              effectiveDate: yearStart, kind: "FORFEIT", leaveYear: year, expiresOn: null,
              dedupeKey: `FOR:${employee.id}:${policy.leaveTypeId}:${year}`, createdById: userId ?? null,
            });
          }
        }
      }

      // 2. Record carried hours that expired unused.
      const carryRow = mine.find((r) => r.kind === "CARRY_FORWARD" && r.leaveYear === year);
      if (carryRow?.expiresOn && asOf >= carryRow.expiresOn && !mine.some((r) => r.dedupeKey === `EXP:${employee.id}:${policy.leaveTypeId}:${year}`)) {
        const live = [...mine];
        const tracker = computeTracker(policy, employee, year, asOf, ledger(live), reqs);
        if (tracker.expiredHours > 0) {
          toCreate.push({
            companyId, employeeId: employee.id, leaveTypeId: policy.leaveTypeId, hours: tracker.expiredHours,
            reason: `Carried-forward leave expired unused on ${carryRow.expiresOn.toISOString().slice(0, 10)}`,
            effectiveDate: carryRow.expiresOn, kind: "EXPIRY", leaveYear: year, expiresOn: null,
            dedupeKey: `EXP:${employee.id}:${policy.leaveTypeId}:${year}`, createdById: userId ?? null,
          });
          expired++;
        }
      }
    }

    if (toCreate.length > 0) await db.leaveBalanceAdjustment.createMany({ data: toCreate, skipDuplicates: true });
  }

  return { carried, expired };
}

/** The ledger of non-request movements (grants, corrections, carry-forward, expiry) for one employee, newest first. */
export async function employeeLeaveLedger(companyId: string, employeeId: string) {
  return db.leaveBalanceAdjustment.findMany({
    where: { companyId, employeeId },
    include: { leaveType: { select: { name: true } } },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
}
