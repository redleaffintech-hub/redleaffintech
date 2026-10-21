import "server-only";
import { db } from "@/lib/db";
import { PAY_FREQUENCY_PERIODS_PER_YEAR, type PayFrequency } from "@/lib/hr-enums";
import { defaultPeriodHours, hourlyRateCents } from "@/lib/payroll-hours";

export interface LeavePayRow {
  employeeId: string;
  vacationHours: number;
  sickHours: number;
  vacationPayCents: number;
  sickPayCents: number;
  /**
   * Approved unpaid leave in the period, net of hours another pay run already
   * deducted. Only salaried employees have a deduction in cents: an hourly
   * employee is simply not paid for hours they did not work.
   */
  unpaidHours: number;
  unpaidCents: number;
  /** Salaried employees only: the period's regular hours/pay net of leave. Null leaves the line's own figures alone. */
  regularHours: number | null;
  regularPayCents: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

/**
 * Approved, paid vacation and sick leave falling inside a pay period, turned
 * into the pay-line figures. A request that straddles the period boundary
 * contributes the share of its hours that falls inside (by calendar day), so
 * two consecutive periods never pay the same hours twice. For a salaried
 * employee the period's gross stays the salary: leave is paid at the hourly
 * equivalent and regular pay is what remains (e.g. 80h = 68 regular + 8
 * vacation + 4 sick).
 */
export async function approvedLeaveForPeriod(
  companyId: string,
  start: Date,
  end: Date,
  opts: { excludePayRunId?: string | null; ignoreDeducted?: boolean } = {},
): Promise<LeavePayRow[]> {
  const [employees, requests, priorLines] = await Promise.all([
    db.employee.findMany({
      where: { companyId, employmentStatus: { not: "TERMINATED" } },
      select: { id: true, compensationType: true, payRateCents: true, payFrequency: true, standardHoursPerWeek: true },
    }),
    db.leaveRequest.findMany({
      where: {
        companyId,
        status: "APPROVED",
        startDate: { lte: end },
        endDate: { gte: start },
        OR: [{ leaveType: { isPaid: true, category: { in: ["VACATION", "SICK"] } } }, { leaveType: { isPaid: false } }],
      },
      include: { leaveType: { select: { category: true, isPaid: true } } },
    }),
    // Unpaid leave other pay runs (draft or posted) already deducted for an overlapping period.
    opts.ignoreDeducted
      ? Promise.resolve([])
      : db.payRunLine.findMany({
          where: {
            companyId,
            unpaidLeaveCents: { gt: 0 },
            payRun: {
              status: { not: "VOID" },
              payPeriodStart: { lte: end },
              payPeriodEnd: { gte: start },
              ...(opts.excludePayRunId ? { id: { not: opts.excludePayRunId } } : {}),
            },
          },
          select: { employeeId: true, unpaidLeaveHours: true, payRun: { select: { payPeriodStart: true, payPeriodEnd: true } } },
        }),
  ]);

  const rows: LeavePayRow[] = [];
  for (const employee of employees) {
    let vacation = 0;
    let sick = 0;
    let unpaid = 0;
    for (const request of requests.filter((r) => r.employeeId === employee.id)) {
      const total = Math.round((request.endDate.getTime() - request.startDate.getTime()) / DAY) + 1;
      const from = Math.max(request.startDate.getTime(), start.getTime());
      const to = Math.min(request.endDate.getTime(), end.getTime());
      const inside = Math.max(0, Math.round((to - from) / DAY) + 1);
      const hours = inside >= total ? request.hours : (request.hours * inside) / total;
      if (!request.leaveType.isPaid) unpaid += hours;
      else if (request.leaveType.category === "VACATION") vacation += hours;
      else sick += hours;
    }
    vacation = round2(vacation);
    sick = round2(sick);

    // Hours an overlapping pay run already took off the salary are not taken twice.
    const deducted = priorLines
      .filter((l) => l.employeeId === employee.id)
      .reduce((sum, l) => sum + (l.unpaidLeaveHours ?? 0), 0);
    unpaid = round2(Math.max(0, unpaid - deducted));

    const rate = hourlyRateCents(employee);
    const vacationPayCents = rate ? Math.round(vacation * rate) : 0;
    const sickPayCents = rate ? Math.round(sick * rate) : 0;

    const salaried = employee.compensationType === "SALARY";
    const unpaidCents = salaried && rate ? Math.round(unpaid * rate) : 0;

    let regularHours: number | null = null;
    let regularPayCents: number | null = null;
    if (employee.compensationType === "SALARY") {
      const periods = PAY_FREQUENCY_PERIODS_PER_YEAR[employee.payFrequency as PayFrequency] ?? 26;
      const periodPay = Math.round(employee.payRateCents / periods);
      const periodHours = defaultPeriodHours(employee);
      regularPayCents = Math.max(0, periodPay - vacationPayCents - sickPayCents - unpaidCents);
      regularHours = periodHours != null ? round2(Math.max(0, periodHours - vacation - sick - unpaid)) : null;
    }

    rows.push({ employeeId: employee.id, vacationHours: vacation, sickHours: sick, vacationPayCents, sickPayCents, unpaidHours: unpaid, unpaidCents, regularHours, regularPayCents });
  }
  return rows;
}

export interface UnpaidLeaveGap {
  payRunId: string;
  payRunNumber: string;
  employeeName: string;
  period: string;
  missingHours: number;
  missingCents: number;
}

/**
 * Posted salaried pay lines whose period contains approved unpaid leave that was
 * never deducted. They are flagged for review; correcting one goes through the
 * normal void-and-reissue (or adjustment) path, never a silent rewrite.
 */
export async function unpaidLeaveGaps(companyId: string): Promise<UnpaidLeaveGap[]> {
  const runs = await db.payRun.findMany({
    where: { companyId, status: "POSTED" },
    orderBy: { payDate: "desc" },
    take: 26,
    include: { lines: { include: { employee: { select: { legalFirstName: true, legalLastName: true, compensationType: true } } } } },
  });
  const gaps: UnpaidLeaveGap[] = [];
  for (const run of runs) {
    const rows = await approvedLeaveForPeriod(companyId, run.payPeriodStart, run.payPeriodEnd, { ignoreDeducted: true });
    for (const line of run.lines) {
      if (line.employee.compensationType !== "SALARY") continue;
      const row = rows.find((r) => r.employeeId === line.employeeId);
      if (!row || row.unpaidCents <= 0) continue;
      if (line.unpaidLeaveCents >= row.unpaidCents) continue;
      gaps.push({
        payRunId: run.id,
        payRunNumber: run.number,
        employeeName: `${line.employee.legalFirstName} ${line.employee.legalLastName}`,
        period: `${run.payPeriodStart.toISOString().slice(0, 10)} to ${run.payPeriodEnd.toISOString().slice(0, 10)}`,
        missingHours: round2(row.unpaidHours - (line.unpaidLeaveHours ?? 0)),
        missingCents: row.unpaidCents - line.unpaidLeaveCents,
      });
    }
  }
  return gaps;
}
