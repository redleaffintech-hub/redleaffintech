import "server-only";

import { db } from "@/lib/db";

export interface PayrollYtd {
  grossCents: number;
  pensionableEarningsCents: number;
  insurableEarningsCents: number;
  cppCents: number;
  cpp2Cents: number;
  eiCents: number;
  qpipCents: number;
  federalTaxCents: number;
  provincialTaxCents: number;
  netCents: number;
  /** Earnings by bucket, for the pay stub's YTD column. */
  regularPayCents: number;
  overtimePayCents: number;
  vacationPayCents: number;
  sickPayCents: number;
  bonusCents: number;
  retroactivePayCents: number;
  statutoryHolidayPayCents: number;
  medicalInsuranceCents: number;
  otherDeductionsCents: number;
}

const EMPTY_YTD: PayrollYtd = {
  grossCents: 0,
  pensionableEarningsCents: 0,
  insurableEarningsCents: 0,
  cppCents: 0,
  cpp2Cents: 0,
  eiCents: 0,
  qpipCents: 0,
  federalTaxCents: 0,
  provincialTaxCents: 0,
  netCents: 0,
  regularPayCents: 0,
  overtimePayCents: 0,
  vacationPayCents: 0,
  sickPayCents: 0,
  bonusCents: 0,
  retroactivePayCents: 0,
  statutoryHolidayPayCents: 0,
  medicalInsuranceCents: 0,
  otherDeductionsCents: 0,
};

/**
 * An employee's payroll totals for a calendar year, up to (and including) a
 * given date. Computed on read from every POSTED pay run's lines — never
 * cached or stored as a running total, the same way this app treats every
 * other balance (see LeaveBalanceAdjustment's doc comment for the same
 * reasoning applied to leave hours).
 *
 * "Pensionable"/"insurable" earnings here are approximated as gross pay —
 * this app does not yet model the handful of earnings types Canadian payroll
 * excludes from CPP/EI (e.g. some taxable benefits), so treat those two
 * figures as close, not exact, until that distinction is added.
 */
export async function payrollYtd(
  companyId: string,
  employeeId: string,
  year: number,
  throughDate: Date,
  /**
   * When set (a pay stub), YTD stops at that pay run: earlier pay dates plus
   * this run, and — for other runs paid the same day — only those posted
   * before it, so two same-day runs are never counted into each other's stub.
   */
  upTo?: { payRunId: string; createdAt: Date },
): Promise<PayrollYtd> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const lines = await db.payRunLine.findMany({
    where: {
      companyId,
      employeeId,
      payRun: {
        status: "POSTED",
        payDate: { gte: yearStart, lte: throughDate },
        ...(upTo
          ? { OR: [{ payDate: { lt: throughDate } }, { id: upTo.payRunId }, { payDate: throughDate, createdAt: { lt: upTo.createdAt } }] }
          : {}),
      },
    },
    select: {
      grossPayCents: true,
      cppCents: true,
      cpp2Cents: true,
      eiCents: true,
      qpipCents: true,
      federalTaxCents: true,
      provincialTaxCents: true,
      netPayCents: true,
      regularPayCents: true,
      overtimePayCents: true,
      vacationPayCents: true,
      sickPayCents: true,
      bonusCents: true,
      retroactivePayCents: true,
      statutoryHolidayPayCents: true,
      medicalInsuranceCents: true,
      otherDeductionsCents: true,
    },
  });

  if (lines.length === 0) return EMPTY_YTD;

  return lines.reduce<PayrollYtd>(
    (totals, line) => ({
      grossCents: totals.grossCents + line.grossPayCents,
      pensionableEarningsCents: totals.pensionableEarningsCents + line.grossPayCents,
      insurableEarningsCents: totals.insurableEarningsCents + line.grossPayCents,
      cppCents: totals.cppCents + line.cppCents,
      cpp2Cents: totals.cpp2Cents + line.cpp2Cents,
      eiCents: totals.eiCents + line.eiCents,
      qpipCents: totals.qpipCents + line.qpipCents,
      federalTaxCents: totals.federalTaxCents + line.federalTaxCents,
      provincialTaxCents: totals.provincialTaxCents + line.provincialTaxCents,
      netCents: totals.netCents + line.netPayCents,
      regularPayCents: totals.regularPayCents + line.regularPayCents,
      overtimePayCents: totals.overtimePayCents + line.overtimePayCents,
      vacationPayCents: totals.vacationPayCents + line.vacationPayCents,
      sickPayCents: totals.sickPayCents + line.sickPayCents,
      bonusCents: totals.bonusCents + line.bonusCents,
      retroactivePayCents: totals.retroactivePayCents + line.retroactivePayCents,
      statutoryHolidayPayCents: totals.statutoryHolidayPayCents + line.statutoryHolidayPayCents,
      medicalInsuranceCents: totals.medicalInsuranceCents + line.medicalInsuranceCents,
      otherDeductionsCents: totals.otherDeductionsCents + line.otherDeductionsCents,
    }),
    { ...EMPTY_YTD },
  );
}
