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
import { defaultPeriodHours, hourlyRegularPayCents } from "@/lib/payroll-hours";

export interface PayRunLineFormValue {
  employeeId: string;
  employeeName: string;
  /** Employee facts the form needs to keep hourly pay and the CPP/QPP labels right. */
  province: string;
  isHourly: boolean;
  /** Hourly rate in cents for hourly employees, else 0. */
  hourlyRateCents: number;
  include: boolean;
  regularHours: string;
  overtimeHours: string;
  vacationHours: string;
  sickHours: string;
  statutoryHolidayHours: string;
  /** Unpaid leave already taken out of regular pay (set by Pull approved leave). */
  unpaidLeaveHours: string;
  unpaidLeave: string;
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
  /** Quebec employees only — blank/0 elsewhere. */
  qpip: string;
  federalTax: string;
  provincialTax: string;
  other: string;
  /** Blank = withhold the employee's configured premium (if any); "0" waives it. */
  medicalInsurance: string;
  employerCpp: string;
  employerCpp2: string;
  employerEi: string;
  employerQpip: string;
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
  standardHoursPerWeek: number | null;
  employeeType: string;
  provinceOfEmployment: string;
}

const centsToStr = (cents: number) => (cents / 100).toFixed(2);

/** Salaried: gross defaults to salary / pay periods per year. Hourly: left blank for hours to be entered. */
export function defaultLineFor(employee: EmployeeForDefaults): PayRunLineFormValue {
  const periodsPerYear = PAY_FREQUENCY_PERIODS_PER_YEAR[employee.payFrequency as PayFrequency] ?? 26;
  const hours = defaultPeriodHours(employee);
  // Salaried: salary / periods. Hourly: standard period hours x rate (casual staff have no standard
  // hours, so their pay stays blank until hours are typed).
  const grossPay =
    employee.compensationType === "SALARY"
      ? centsToStr(Math.round(employee.payRateCents / periodsPerYear))
      : hours
        ? centsToStr(hourlyRegularPayCents(employee, hours) ?? 0)
        : "";

  return {
    employeeId: employee.id,
    employeeName: `${employee.preferredName || employee.legalFirstName} ${employee.legalLastName}`,
    province: employee.provinceOfEmployment,
    isHourly: employee.compensationType === "HOURLY",
    hourlyRateCents: employee.compensationType === "HOURLY" ? employee.payRateCents : 0,
    include: true,
    regularHours: hours?.toString() ?? "",
    overtimeHours: "",
    vacationHours: "",
    sickHours: "",
    statutoryHolidayHours: "",
    unpaidLeaveHours: "",
    unpaidLeave: "",
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
    qpip: "",
    federalTax: "",
    provincialTax: "",
    other: "",
    medicalInsurance: "",
    employerCpp: "",
    employerCpp2: "",
    employerEi: "",
    employerQpip: "",
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
  employee: { legalFirstName: string; legalLastName: string; preferredName: string | null; provinceOfEmployment: string; compensationType: string; payRateCents: number };
  regularHours: number | null;
  overtimeHours: number | null;
  vacationHours: number | null;
  sickHours: number | null;
  statutoryHolidayHours: number | null;
  unpaidLeaveHours: number | null;
  unpaidLeaveCents: number;
  medicalInsuranceCents: number;
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
  qpipCents: number;
  federalTaxCents: number;
  provincialTaxCents: number;
  otherDeductionsCents: number;
  employerCppCents: number;
  employerCpp2Cents: number;
  employerEiCents: number;
  employerQpipCents: number;
  notes: string | null;
}

function lineFromSaved(line: SavedPayRunLine): PayRunLineFormValue {
  return {
    employeeId: line.employeeId,
    employeeName: `${line.employee.preferredName || line.employee.legalFirstName} ${line.employee.legalLastName}`,
    province: line.employee.provinceOfEmployment,
    isHourly: line.employee.compensationType === "HOURLY",
    hourlyRateCents: line.employee.compensationType === "HOURLY" ? line.employee.payRateCents : 0,
    include: true,
    regularHours: line.regularHours?.toString() ?? "",
    overtimeHours: line.overtimeHours?.toString() ?? "",
    vacationHours: line.vacationHours?.toString() ?? "",
    sickHours: line.sickHours?.toString() ?? "",
    statutoryHolidayHours: line.statutoryHolidayHours?.toString() ?? "",
    unpaidLeaveHours: line.unpaidLeaveHours?.toString() ?? "",
    unpaidLeave: centsToStr(line.unpaidLeaveCents),
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
    qpip: centsToStr(line.qpipCents),
    federalTax: centsToStr(line.federalTaxCents),
    provincialTax: centsToStr(line.provincialTaxCents),
    other: centsToStr(line.otherDeductionsCents),
    // Saved lines keep exactly what was stored, so re-saving never re-derives it.
    medicalInsurance: centsToStr(line.medicalInsuranceCents),
    employerCpp: centsToStr(line.employerCppCents),
    employerCpp2: centsToStr(line.employerCpp2Cents),
    employerEi: centsToStr(line.employerEiCents),
    employerQpip: centsToStr(line.employerQpipCents),
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
