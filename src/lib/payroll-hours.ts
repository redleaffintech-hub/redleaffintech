/**
 * Pure payroll helpers shared by the pay-run engine, the pay-run form and the
 * pay stub PDF: how many hours a pay buys, at what rate, and whether the
 * employee's medical-insurance premium falls on a given pay date.
 */
import { PAY_FREQUENCY_PERIODS_PER_YEAR, type PayFrequency } from "@/lib/hr-enums";

export interface HoursEmployee {
  compensationType: string;
  payRateCents: number;
  payFrequency: string;
  standardHoursPerWeek: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Regular hours a full pay period covers for a salaried employee with standard hours on file; otherwise null (hourly staff enter hours). */
export function defaultPeriodHours(employee: HoursEmployee): number | null {
  if (employee.compensationType !== "SALARY" || !employee.standardHoursPerWeek) return null;
  const periods = PAY_FREQUENCY_PERIODS_PER_YEAR[employee.payFrequency as PayFrequency] ?? 26;
  return round2((employee.standardHoursPerWeek * 52) / periods);
}

/** The employee's hourly rate in cents (a salary is converted using its standard hours), or null when it cannot be known. */
export function hourlyRateCents(employee: HoursEmployee): number | null {
  if (employee.compensationType === "HOURLY") return employee.payRateCents;
  if (employee.standardHoursPerWeek) return Math.round(employee.payRateCents / (52 * employee.standardHoursPerWeek));
  return null;
}

/** Hours that a given pay amount represents at the employee's hourly rate (vacation/sick/stat pay entered without hours). */
export function impliedHours(payCents: number, employee: HoursEmployee): number | null {
  const rate = hourlyRateCents(employee);
  if (!rate || payCents <= 0) return null;
  return round2(payCents / rate);
}

export interface MedicalInsuranceConfig {
  medicalInsuranceEnabled: boolean;
  medicalInsuranceMethod: string;
  medicalInsuranceAmountCents: number;
  medicalInsurancePercentMicro: number;
  medicalInsuranceFrequency: string;
  payFrequency: string;
}

/** Days between pay dates, used to recognise the first / last pay of a month. */
const PERIOD_DAYS: Record<string, number> = { WEEKLY: 7, BIWEEKLY: 14, SEMI_MONTHLY: 15, MONTHLY: 31 };

/**
 * The medical-insurance premium to withhold on this pay: zero unless it is
 * enabled for the employee AND this pay date is one the configured frequency
 * covers. "First pay of the month" is a pay date within one pay period of the
 * month's start; "last pay" is one with less than a pay period left in the month.
 */
export function medicalInsuranceCents(employee: MedicalInsuranceConfig, grossPayCents: number, payDate: Date): number {
  if (!employee.medicalInsuranceEnabled) return 0;

  const periodDays = PERIOD_DAYS[employee.payFrequency] ?? 14;
  const day = payDate.getUTCDate();
  const daysInMonth = new Date(Date.UTC(payDate.getUTCFullYear(), payDate.getUTCMonth() + 1, 0)).getUTCDate();
  if (employee.payFrequency !== "MONTHLY") {
    const isFirst = employee.payFrequency === "SEMI_MONTHLY" ? day <= 15 : day <= periodDays;
    const isLast = employee.payFrequency === "SEMI_MONTHLY" ? day > 15 : day + periodDays > daysInMonth;
    if (employee.medicalInsuranceFrequency === "FIRST_PAY_OF_MONTH" && !isFirst) return 0;
    if (employee.medicalInsuranceFrequency === "LAST_PAY_OF_MONTH" && !isLast) return 0;
  }

  if (employee.medicalInsuranceMethod === "PERCENT_OF_GROSS") {
    return Math.round((grossPayCents * employee.medicalInsurancePercentMicro) / 1_000_000);
  }
  return employee.medicalInsuranceAmountCents;
}
