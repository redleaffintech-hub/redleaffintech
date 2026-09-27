/**
 * Shared between the server pages (new/edit) and the client pay-run form.
 *
 * Kept out of pay-run-form.tsx on purpose: that file is "use client", and a
 * plain function exported from a client module becomes a client reference a
 * server component cannot call directly (the exact bug that broke
 * /hr/employees/new — see employee-form-values.ts for the same fix applied
 * there first).
 */
import { PAY_FREQUENCY_PERIODS_PER_YEAR, type PayFrequency } from "@/lib/hr-enums";

export interface PayRunLineFormValue {
  employeeId: string;
  employeeName: string;
  include: boolean;
  regularHours: string;
  overtimeHours: string;
  /** The simple case: no detail panel opened, this is the entire gross. */
  regularPay: string;
  overtimePay: string;
  vacationPay: string;
  sickPay: string;
  bonus: string;
  retroactivePay: string;
  statutoryHolidayPay: string;
  cpp: string;
  cpp2: string;
  ei: string;
  federalTax: string;
  provincialTax: string;
  other: string;
  employerCpp: string;
  employerCpp2: string;
  employerEi: string;
  notes: string;
}

export interface PayRunFormValues {
  id?: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  payDate: string;
  bankAccountId: string;
  memo: string;
  lines: PayRunLineFormValue[];
}

interface EmployeeForDefaults {
  id: string;
  legalFirstName: string;
  legalLastName: string;
  preferredName: string | null;
  compensationType: string;
  payRateCents: number;
  payFrequency: string;
}

const centsToStr = (cents: number) => (cents / 100).toFixed(2);

/** Salaried: gross defaults to salary / pay periods per year. Hourly: left blank for hours to be entered. */
export function defaultLineFor(employee: EmployeeForDefaults): PayRunLineFormValue {
  const periodsPerYear = PAY_FREQUENCY_PERIODS_PER_YEAR[employee.payFrequency as PayFrequency] ?? 26;
  const grossPay =
    employee.compensationType === "SALARY" ? centsToStr(Math.round(employee.payRateCents / periodsPerYear)) : "";

  return {
    employeeId: employee.id,
    employeeName: `${employee.preferredName || employee.legalFirstName} ${employee.legalLastName}`,
    include: true,
    regularHours: "",
    overtimeHours: "",
    regularPay: grossPay,
    overtimePay: "",
    vacationPay: "",
    sickPay: "",
    bonus: "",
    retroactivePay: "",
    statutoryHolidayPay: "",
    cpp: "",
    cpp2: "",
    ei: "",
    federalTax: "",
    provincialTax: "",
    other: "",
    employerCpp: "",
    employerCpp2: "",
    employerEi: "",
    notes: "",
  };
}

export function blankPayRun(defaultBankAccountId: string, employees: EmployeeForDefaults[]): PayRunFormValues {
  return {
    payPeriodStart: "",
    payPeriodEnd: "",
    payDate: "",
    bankAccountId: defaultBankAccountId,
    memo: "",
    lines: employees.map(defaultLineFor),
  };
}

interface SavedPayRunLine {
  employeeId: string;
  employee: { legalFirstName: string; legalLastName: string; preferredName: string | null };
  regularHours: number | null;
  overtimeHours: number | null;
  regularPayCents: number;
  overtimePayCents: number;
  vacationPayCents: number;
  sickPayCents: number;
  bonusCents: number;
  retroactivePayCents: number;
  statutoryHolidayPayCents: number;
  cppCents: number;
  cpp2Cents: number;
  eiCents: number;
  federalTaxCents: number;
  provincialTaxCents: number;
  otherDeductionsCents: number;
  employerCppCents: number;
  employerCpp2Cents: number;
  employerEiCents: number;
  notes: string | null;
}

function lineFromSaved(line: SavedPayRunLine): PayRunLineFormValue {
  return {
    employeeId: line.employeeId,
    employeeName: `${line.employee.preferredName || line.employee.legalFirstName} ${line.employee.legalLastName}`,
    include: true,
    regularHours: line.regularHours?.toString() ?? "",
    overtimeHours: line.overtimeHours?.toString() ?? "",
    regularPay: centsToStr(line.regularPayCents),
    overtimePay: centsToStr(line.overtimePayCents),
    vacationPay: centsToStr(line.vacationPayCents),
    sickPay: centsToStr(line.sickPayCents),
    bonus: centsToStr(line.bonusCents),
    retroactivePay: centsToStr(line.retroactivePayCents),
    statutoryHolidayPay: centsToStr(line.statutoryHolidayPayCents),
    cpp: centsToStr(line.cppCents),
    cpp2: centsToStr(line.cpp2Cents),
    ei: centsToStr(line.eiCents),
    federalTax: centsToStr(line.federalTaxCents),
    provincialTax: centsToStr(line.provincialTaxCents),
    other: centsToStr(line.otherDeductionsCents),
    employerCpp: centsToStr(line.employerCppCents),
    employerCpp2: centsToStr(line.employerCpp2Cents),
    employerEi: centsToStr(line.employerEiCents),
    notes: line.notes ?? "",
  };
}

/**
 * Editing a draft shows every currently-active employee, not just the ones
 * already on it — someone hired after the draft was started can still be
 * added. Anyone already on the draft keeps their saved figures; everyone else
 * starts unincluded with the usual defaults.
 */
export function buildEditLines(savedLines: SavedPayRunLine[], activeEmployees: EmployeeForDefaults[]): PayRunLineFormValue[] {
  const saved = new Map(savedLines.map((l) => [l.employeeId, l]));
  const activeIds = new Set(activeEmployees.map((e) => e.id));

  const fromActive = activeEmployees.map((employee) => {
    const line = saved.get(employee.id);
    return line ? lineFromSaved(line) : defaultLineFor(employee);
  });

  // A line for someone no longer active (terminated since the draft was
  // saved) still needs to appear, pre-filled and included, so editing does
  // not silently drop them.
  const inactiveSaved = savedLines.filter((l) => !activeIds.has(l.employeeId)).map(lineFromSaved);

  return [...fromActive, ...inactiveSaved];
}
