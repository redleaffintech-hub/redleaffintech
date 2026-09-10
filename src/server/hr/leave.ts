import "server-only";

import { leaveBalanceAdjustments, leaveRequests, leaveTypes } from "@/server/db/hr";
import { newId } from "@/server/db/firestore";

/**
 * The leave types every new company starts with. All editable/archivable from
 * /hr/time-off/leave-types afterward. Statutory job-protected leaves are
 * `trackBalance: false` — recorded, not accrued.
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

/** Rows for the default leave types, for a caller batching company setup. */
export function defaultLeaveTypeRows(companyId: string) {
  return DEFAULT_LEAVE_TYPES.map((t) => ({
    id: newId(),
    companyId,
    ...t,
    isActive: true,
    createdAt: new Date(),
  }));
}

export async function createDefaultLeaveTypes(companyId: string) {
  for (const t of DEFAULT_LEAVE_TYPES) {
    await leaveTypes.create({ companyId, ...t, isActive: true } as Parameters<typeof leaveTypes.create>[0]);
  }
}

export interface LeaveBalance {
  leaveTypeId: string;
  grantedHours: number;
  usedHours: number;
  balanceHours: number;
}

export async function leaveBalance(
  companyId: string,
  employeeId: string,
  leaveTypeId: string,
): Promise<LeaveBalance> {
  const [adjustments, approved] = await Promise.all([
    leaveBalanceAdjustments.list(companyId, {
      where: [
        ["employeeId", "==", employeeId],
        ["leaveTypeId", "==", leaveTypeId],
      ],
    }),
    leaveRequests.list(companyId, {
      where: [
        ["employeeId", "==", employeeId],
        ["leaveTypeId", "==", leaveTypeId],
        ["status", "==", "APPROVED"],
      ],
    }),
  ]);
  const grantedHours = adjustments.reduce((s, a) => s + a.hours, 0);
  const usedHours = approved.reduce((s, r) => s + r.hours, 0);
  return { leaveTypeId, grantedHours, usedHours, balanceHours: grantedHours - usedHours };
}

export async function leaveBalancesForEmployee(
  companyId: string,
  employeeId: string,
): Promise<(LeaveBalance & { leaveTypeName: string })[]> {
  const tracked = (
    await leaveTypes.list(companyId, { where: [["trackBalance", "==", true]], orderBy: "name" })
  );
  const [adjustments, approved] = await Promise.all([
    leaveBalanceAdjustments.list(companyId, { where: [["employeeId", "==", employeeId]] }),
    leaveRequests.list(companyId, {
      where: [
        ["employeeId", "==", employeeId],
        ["status", "==", "APPROVED"],
      ],
    }),
  ]);
  return tracked.map((type) => {
    const grantedHours = adjustments
      .filter((a) => a.leaveTypeId === type.id)
      .reduce((s, a) => s + a.hours, 0);
    const usedHours = approved
      .filter((r) => r.leaveTypeId === type.id)
      .reduce((s, r) => s + r.hours, 0);
    return {
      leaveTypeId: type.id,
      leaveTypeName: type.name,
      grantedHours,
      usedHours,
      balanceHours: grantedHours - usedHours,
    };
  });
}
