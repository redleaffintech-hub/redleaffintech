import "server-only";

import { db } from "@/lib/db";
import { getCompanyProfile } from "@/server/companies/profile";
import { payrollYtd } from "@/server/payroll/ytd";
import { defaultPeriodHours, impliedHours } from "@/lib/payroll-hours";

export interface StubEarningsRow {
  label: string;
  hours: number | null;
  /** Effective hourly rate in cents (pay / hours), when hours are known. */
  rateCents: number | null;
  currentCents: number;
  ytdCents: number;
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

  const rate = (cents: number, hours: number | null) => (hours && hours > 0 && cents > 0 ? Math.round(cents / hours) : null);
  const earn = (label: string, hours: number | null, current: number, ytdCents: number): StubEarningsRow => ({
    label,
    hours,
    rateCents: rate(current, hours),
    currentCents: current,
    ytdCents,
  });

  const earnings: StubEarningsRow[] = [
    earn("Regular pay", regularHours, line.regularPayCents, ytd.regularPayCents),
    ...[
      earn("Overtime pay", line.overtimeHours ?? null, line.overtimePayCents, ytd.overtimePayCents),
      earn("Vacation pay", vacationHours, line.vacationPayCents, ytd.vacationPayCents),
      earn("Sick pay", sickHours, line.sickPayCents, ytd.sickPayCents),
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

  return { line, employee, payRun, profile, ytd, earnings, deductions, totalDeductions };
}

export type PayStub = NonNullable<Awaited<ReturnType<typeof loadPayStub>>>;
