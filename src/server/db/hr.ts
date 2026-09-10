import "server-only";

import { makeDocRepo } from "./_doc-repo";
import type {
  Department,
  Employee,
  LeaveBalanceAdjustment,
  LeaveRequest,
  LeaveType,
} from "./types";

/** HR module collections (§HR). Replaces the corresponding `db.*`. */

export const departments = makeDocRepo<Department>("departments", ["createdAt", "updatedAt"], {
  embedLines: false,
});

export const employees = makeDocRepo<Employee>(
  "employees",
  ["dateOfBirth", "hireDate", "terminationDate", "createdAt", "updatedAt"],
  { embedLines: false },
);

export const leaveTypes = makeDocRepo<LeaveType>("leaveTypes", ["createdAt"], {
  embedLines: false,
  touchUpdatedAt: false,
});

export const leaveRequests = makeDocRepo<LeaveRequest>(
  "leaveRequests",
  ["startDate", "endDate", "decidedAt", "createdAt", "updatedAt"],
  { embedLines: false },
);

export const leaveBalanceAdjustments = makeDocRepo<LeaveBalanceAdjustment>(
  "leaveBalanceAdjustments",
  ["effectiveDate", "createdAt"],
  { embedLines: false, touchUpdatedAt: false },
);

/** Approved-leave hours + signed adjustments give an employee's balance. */
export async function leaveBalanceHours(
  companyId: string,
  employeeId: string,
  leaveTypeId: string,
): Promise<number> {
  const [reqs, adjs] = await Promise.all([
    leaveRequests.list(companyId, {
      where: [
        ["employeeId", "==", employeeId],
        ["leaveTypeId", "==", leaveTypeId],
        ["status", "==", "APPROVED"],
      ],
    }),
    leaveBalanceAdjustments.list(companyId, {
      where: [
        ["employeeId", "==", employeeId],
        ["leaveTypeId", "==", leaveTypeId],
      ],
    }),
  ]);
  const granted = adjs.reduce((s, a) => s + a.hours, 0);
  const taken = reqs.reduce((s, r) => s + r.hours, 0);
  return granted - taken;
}
