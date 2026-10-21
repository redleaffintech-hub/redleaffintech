import "server-only";

import { db } from "@/lib/db";
import { getCompanyProfile } from "@/server/companies/profile";
import { payrollYtd } from "@/server/payroll/ytd";
import { leaveTrackers } from "@/server/hr/leave-policy";
import { defaultPeriodHours, impliedHours } from "@/lib/payroll-hours";

export interface StubEarningsRow {
  label: string;
  hours: number | null;
  /** Effective hourly rate in cents (pay / hours), when hours are known. */
  rateCents: number | null;
  currentCents: number;
  ytdCents: number;
}

/** One line of the Leave Balance Summary; null figures mean the employee has no such leave (shown as N/A). */
export interface StubLeaveRow {
  label: string;
  /** Pro-rated hours earned this leave year up to the pay date. */
  accruedHours: number | null;
  /** Carried-forward (net of expired) plus manual adjustments. */
  carriedHours: number | null;
  /** Approved leave taken this leave year up to the pay date. */
  availedHours: number | null;
  remainingHours: number | null;
}

export interface StubDeductionRow {
  label: string;
  currentCents: number;
  ytdCents: number;
}

/**
 * Everything a pay stub shows, built once so the on-screen stub and the PDF can
 * never disagree. Only POSTED pay runs have stubs.
 */
export async function loadPayStub(companyId: string, payRunId: string, employeeId: string) {
  const line = await db.payRunLine.findFirst({
    where: { payRunId, employeeId, companyId },
    include: { payRun: true, employee: true },
  });
  if (!line || line.payRun.status !== "POSTED") return null;

  const { employee, payRun } = line;
  const [profile, ytd] = await Promise.all([
    getCompanyProfile(companyId),
    payrollYtd(companyId, employeeId, payRun.payDate.getUTCFullYear(), payRun.payDate, {
      payRunId: payRun.id,
      createdAt: payRun.createdAt,
    }),
  ]);

  // Hours shown for every employee type. Stored hours win; older pay runs saved
  // before hours were tracked fall back to the employee's standard hours / rate.
  const regularHours = line.regularHours ?? (line.regularPayCents > 0 ? defaultPeriodHours(employee) : null);
  const vacationHours = line.vacationHours ?? impliedHours(line.vacationPayCents, employee);
  const sickHours = line.sickHours ?? impliedHours(line.sickPayCents, employee);
  const statHours = line.statutoryHolidayHours ?? impliedHours(line.statutoryHolidayPayCents, employee);

  // Leave balances as of the pay date, from the same tracker the Leave Balances page uses.
  const trackers = await leaveTrackers(companyId, { employeeId, asOf: payRun.payDate, historical: true });
  const leaveRow = (label: string, category: string): StubLeaveRow => {
    const mine = trackers.filter((t) => t.category === category && t.tracker.entitlement.eligible);
    if (mine.length === 0) return { label, accruedHours: null, carriedHours: null, availedHours: null, remainingHours: null };
    const sum = (pick: (t: (typeof mine)[number]) => number) => Math.round(mine.reduce((s, t) => s + pick(t), 0) * 100) / 100;
    return {
      label,
      accruedHours: sum((t) => t.tracker.allocatedHours),
      carriedHours: sum((t) => t.tracker.carriedForwardHours - t.tracker.expiredHours + t.tracker.adjustmentHours),
      availedHours: sum((t) => t.tracker.usedHours),
      remainingHours: sum((t) => t.tracker.remainingHours),
    };
  };
  const leaveSummary: StubLeaveRow[] = [leaveRow("Vacation leave", "VACATION"), leaveRow("Sick leave", "SICK")];

  const rate = (cents: number, hours: number | null) => (hours && hours > 0 && cents > 0 ? Math.round(cents / hours) : null);
  const earn = (label: string, hours: number | null, current: number, ytdCents: number): StubEarningsRow => ({
    label,
    hours,
    rateCents: rate(current, hours),
    currentCents: current,
    ytdCents,
  });

  const earnings: StubEarningsRow[] = [
    // Regular pay is stored net of unpaid leave; the stub shows the scheduled
    // amount and the unpaid-leave deduction as its own negative line.
    earn(
      "Regular pay",
      regularHours !== null && line.unpaidLeaveHours ? Math.round((regularHours + line.unpaidLeaveHours) * 100) / 100 : regularHours,
      line.regularPayCents + line.unpaidLeaveCents,
      ytd.regularPayCents + ytd.unpaidLeaveCents,
    ),
    ...[
      earn("Overtime pay", line.overtimeHours ?? null, line.overtimePayCents, ytd.overtimePayCents),
      earn("Vacation pay", vacationHours, line.vacationPayCents, ytd.vacationPayCents),
      earn("Sick pay", sickHours, line.sickPayCents, ytd.sickPayCents),
      earn("Unpaid leave deduction", line.unpaidLeaveHours ?? null, -line.unpaidLeaveCents, -ytd.unpaidLeaveCents),
      earn("Bonus", null, line.bonusCents, ytd.bonusCents),
      earn("Retroactive pay", null, line.retroactivePayCents, ytd.retroactivePayCents),
      earn("Statutory holiday pay", statHours, line.statutoryHolidayPayCents, ytd.statutoryHolidayPayCents),
    ].filter((row) => row.currentCents !== 0 || row.ytdCents !== 0),
  ];

  const deductions: StubDeductionRow[] = [
    { label: "CPP", currentCents: line.cppCents, ytdCents: ytd.cppCents },
    { label: "CPP2", currentCents: line.cpp2Cents, ytdCents: ytd.cpp2Cents },
    { label: "EI", currentCents: line.eiCents, ytdCents: ytd.eiCents },
    // QPIP applies to Quebec employees only.
    ...(line.qpipCents !== 0 || ytd.qpipCents !== 0 ? [{ label: "QPIP", currentCents: line.qpipCents, ytdCents: ytd.qpipCents }] : []),
    { label: "Federal tax", currentCents: line.federalTaxCents, ytdCents: ytd.federalTaxCents },
    { label: "Provincial tax", currentCents: line.provincialTaxCents, ytdCents: ytd.provincialTaxCents },
    ...(line.medicalInsuranceCents !== 0 || ytd.medicalInsuranceCents !== 0
      ? [{ label: "Medical insurance", currentCents: line.medicalInsuranceCents, ytdCents: ytd.medicalInsuranceCents }]
      : []),
    ...(line.otherDeductionsCents !== 0 || ytd.otherDeductionsCents !== 0
      ? [{ label: line.otherDeductionsNote || "Other deductions", currentCents: line.otherDeductionsCents, ytdCents: ytd.otherDeductionsCents }]
      : []),
  ];
  const totalDeductions = {
    currentCents: deductions.reduce((s, d) => s + d.currentCents, 0),
    ytdCents: deductions.reduce((s, d) => s + d.ytdCents, 0),
  };

  return { line, employee, payRun, profile, ytd, earnings, deductions, totalDeductions, leaveSummary };
}

export type PayStub = NonNullable<Awaited<ReturnType<typeof loadPayStub>>>;
