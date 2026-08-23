import "server-only";
import type { Tx } from "@/lib/db";
import { db } from "@/lib/db";

/**
 * The leave types every new company starts with — the common set a Canadian
 * employer needs on day one. All are editable/archivable afterward from
 * /hr/time-off/leave-types; nothing here is enforced as mandatory.
 *
 * The job-protected statutory leaves (parental, compassionate care, jury duty)
 * are `trackBalance: false` — they are not something an employee accrues and
 * draws down the way vacation or sick time is, they are simply recorded so the
 * business has a dated record of the leave.
 */
const DEFAULT_LEAVE_TYPES: {
  name: string;
  category: string;
  isPaid: boolean;
  trackBalance: boolean;
}[] = [
  { name: "Vacation", category: "VACATION", isPaid: true, trackBalance: true },
  { name: "Sick", category: "SICK", isPaid: true, trackBalance: true },
  { name: "Personal day", category: "PERSONAL", isPaid: false, trackBalance: true },
  { name: "Bereavement leave", category: "OTHER", isPaid: true, trackBalance: false },
  { name: "Jury duty", category: "STATUTORY", isPaid: false, trackBalance: false },
  { name: "Parental / maternity leave", category: "STATUTORY", isPaid: false, trackBalance: false },
  { name: "Compassionate care leave", category: "STATUTORY", isPaid: false, trackBalance: false },
  { name: "Unpaid leave of absence", category: "UNPAID", isPaid: false, trackBalance: false },
];

export async function createDefaultLeaveTypes(tx: Tx, companyId: string) {
  for (const type of DEFAULT_LEAVE_TYPES) {
    await tx.leaveType.create({ data: { companyId, ...type } });
  }
}

export interface LeaveBalance {
  leaveTypeId: string;
  grantedHours: number;
  usedHours: number;
  balanceHours: number;
}

/**
 * The current balance for one employee/leave type, computed on read as the sum
 * of every ledger adjustment plus every APPROVED request's hours (negative) —
 * never a stored running total, the same way this app never caches a mutable
 * balance anywhere else money or time is tracked (see the party statement and
 * bank reconciliation reports).
 */
export async function leaveBalance(employeeId: string, leaveTypeId: string): Promise<LeaveBalance> {
  const [adjustments, approvedRequests] = await Promise.all([
    db.leaveBalanceAdjustment.findMany({ where: { employeeId, leaveTypeId }, select: { hours: true } }),
    db.leaveRequest.findMany({ where: { employeeId, leaveTypeId, status: "APPROVED" }, select: { hours: true } }),
  ]);

  const grantedHours = adjustments.reduce((sum, a) => sum + a.hours, 0);
  const usedHours = approvedRequests.reduce((sum, r) => sum + r.hours, 0);

  return { leaveTypeId, grantedHours, usedHours, balanceHours: grantedHours - usedHours };
}

/** Every trackBalance leave type's current balance for one employee, in one round trip. */
export async function leaveBalancesForEmployee(companyId: string, employeeId: string): Promise<(LeaveBalance & { leaveTypeName: string })[]> {
  const leaveTypes = await db.leaveType.findMany({ where: { companyId, trackBalance: true }, orderBy: { name: "asc" } });

  const [adjustments, approvedRequests] = await Promise.all([
    db.leaveBalanceAdjustment.findMany({ where: { employeeId, leaveTypeId: { in: leaveTypes.map((t) => t.id) } } }),
    db.leaveRequest.findMany({ where: { employeeId, status: "APPROVED", leaveTypeId: { in: leaveTypes.map((t) => t.id) } } }),
  ]);

  return leaveTypes.map((type) => {
    const grantedHours = adjustments.filter((a) => a.leaveTypeId === type.id).reduce((sum, a) => sum + a.hours, 0);
    const usedHours = approvedRequests.filter((r) => r.leaveTypeId === type.id).reduce((sum, r) => sum + r.hours, 0);
    return { leaveTypeId: type.id, leaveTypeName: type.name, grantedHours, usedHours, balanceHours: grantedHours - usedHours };
  });
}
