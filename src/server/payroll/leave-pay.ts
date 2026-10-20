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
export async function approvedLeaveForPeriod(companyId: string, start: Date, end: Date): Promise<LeavePayRow[]> {
  const [employees, requests] = await Promise.all([
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
        leaveType: { isPaid: true, category: { in: ["VACATION", "SICK"] } },
      },
      include: { leaveType: { select: { category: true } } },
    }),
  ]);

  const rows: LeavePayRow[] = [];
  for (const employee of employees) {
    let vacation = 0;
    let sick = 0;
    for (const request of requests.filter((r) => r.employeeId === employee.id)) {
      const total = Math.round((request.endDate.getTime() - request.startDate.getTime()) / DAY) + 1;
      const from = Math.max(request.startDate.getTime(), start.getTime());
      const to = Math.min(request.endDate.getTime(), end.getTime());
      const inside = Math.max(0, Math.round((to - from) / DAY) + 1);
      const hours = inside >= total ? request.hours : (request.hours * inside) / total;
      if (request.leaveType.category === "VACATION") vacation += hours;
      else sick += hours;
    }
    vacation = round2(vacation);
    sick = round2(sick);

    const rate = hourlyRateCents(employee);
    const vacationPayCents = rate ? Math.round(vacation * rate) : 0;
    const sickPayCents = rate ? Math.round(sick * rate) : 0;

    let regularHours: number | null = null;
    let regularPayCents: number | null = null;
    if (employee.compensationType === "SALARY") {
      const periods = PAY_FREQUENCY_PERIODS_PER_YEAR[employee.payFrequency as PayFrequency] ?? 26;
      const periodPay = Math.round(employee.payRateCents / periods);
      const periodHours = defaultPeriodHours(employee);
      regularPayCents = Math.max(0, periodPay - vacationPayCents - sickPayCents);
      regularHours = periodHours != null ? round2(Math.max(0, periodHours - vacation - sick)) : null;
    }

    rows.push({ employeeId: employee.id, vacationHours: vacation, sickHours: sick, vacationPayCents, sickPayCents, regularHours, regularPayCents });
  }
  return rows;
}
