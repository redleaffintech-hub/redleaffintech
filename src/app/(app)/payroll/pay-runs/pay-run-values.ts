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
  grossPay: string;
  cpp: string;
  ei: string;
  federalTax: string;
  provincialTax: string;
  other: string;
  employerCpp: string;
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
    grossPay,
    cpp: "",
    ei: "",
    federalTax: "",
    provincialTax: "",
    other: "",
    employerCpp: "",
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
  grossPayCents: number;
  cppCents: number;
  eiCents: number;
  federalTaxCents: number;
  provincialTaxCents: number;
  otherDeductionsCents: number;
  employerCppCents: number;
  employerEiCents: number;
  notes: string | null;
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
    if (!line) return defaultLineFor(employee);
    return {
      employeeId: employee.id,
      employeeName: `${line.employee.preferredName || line.employee.legalFirstName} ${line.employee.legalLastName}`,
      include: true,
      regularHours: line.regularHours?.toString() ?? "",
      grossPay: centsToStr(line.grossPayCents),
      cpp: centsToStr(line.cppCents),
      ei: centsToStr(line.eiCents),
      federalTax: centsToStr(line.federalTaxCents),
      provincialTax: centsToStr(line.provincialTaxCents),
      other: centsToStr(line.otherDeductionsCents),
      employerCpp: centsToStr(line.employerCppCents),
      employerEi: centsToStr(line.employerEiCents),
      notes: line.notes ?? "",
    };
  });

  // A line for someone no longer active (terminated since the draft was
  // saved) still needs to appear, pre-filled and included, so editing does
  // not silently drop them.
  const inactiveSaved = savedLines
    .filter((l) => !activeIds.has(l.employeeId))
    .map((line) => ({
      employeeId: line.employeeId,
      employeeName: `${line.employee.preferredName || line.employee.legalFirstName} ${line.employee.legalLastName}`,
      include: true,
      regularHours: line.regularHours?.toString() ?? "",
      grossPay: centsToStr(line.grossPayCents),
      cpp: centsToStr(line.cppCents),
      ei: centsToStr(line.eiCents),
      federalTax: centsToStr(line.federalTaxCents),
      provincialTax: centsToStr(line.provincialTaxCents),
      other: centsToStr(line.otherDeductionsCents),
      employerCpp: centsToStr(line.employerCppCents),
      employerEi: centsToStr(line.employerEiCents),
      notes: line.notes ?? "",
    }));

  return [...fromActive, ...inactiveSaved];
}
