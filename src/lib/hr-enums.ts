/**
 * HR module vocabulary — kept separate from `enums.ts` so this feature's shape
 * stays easy to review on its own, the way `lib/tax/regional-rate-types.ts` does
 * for regional tax rates.
 */

export const EMPLOYEE_TYPES = ["FULL_TIME", "PART_TIME", "CASUAL", "SEASONAL", "CONTRACT"] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CASUAL: "Casual",
  SEASONAL: "Seasonal",
  CONTRACT: "Contract",
};

export const EMPLOYMENT_STATUSES = ["ACTIVE", "ON_LEAVE", "TERMINATED"] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  TERMINATED: "Terminated",
};

export const COMPENSATION_TYPES = ["SALARY", "HOURLY"] as const;
export type CompensationType = (typeof COMPENSATION_TYPES)[number];

export const PAY_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

export const PAY_FREQUENCY_LABELS: Record<PayFrequency, string> = {
  WEEKLY: "Weekly (52/yr)",
  BIWEEKLY: "Bi-weekly (26/yr)",
  SEMI_MONTHLY: "Semi-monthly (24/yr)",
  MONTHLY: "Monthly (12/yr)",
};

/** Pay periods per year, for converting an annual salary to a per-cheque figure. */
export const PAY_FREQUENCY_PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
};

export const LEAVE_CATEGORIES = ["VACATION", "SICK", "PERSONAL", "STATUTORY", "UNPAID", "OTHER"] as const;
export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number];

export const LEAVE_CATEGORY_LABELS: Record<LeaveCategory, string> = {
  VACATION: "Vacation",
  SICK: "Sick",
  PERSONAL: "Personal",
  STATUTORY: "Statutory (job-protected)",
  UNPAID: "Unpaid",
  OTHER: "Other",
};

export const LEAVE_REQUEST_STATUSES = ["PENDING", "APPROVED", "DECLINED", "CANCELLED"] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

export const LEAVE_REQUEST_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
};

/**
 * Loosely mirrors the categories a Record of Employment eventually needs, without
 * claiming to be the CRA's full ROE reason-code list — this module does not
 * generate an ROE. It exists so a termination is recorded with a real reason from
 * day one rather than free text nobody can later report on.
 */
export const TERMINATION_REASON_CATEGORIES = [
  "RESIGNATION",
  "DISMISSAL_WITH_CAUSE",
  "DISMISSAL_WITHOUT_CAUSE",
  "LAYOFF_SHORTAGE_OF_WORK",
  "END_OF_CONTRACT",
  "RETIREMENT",
  "OTHER",
] as const;
export type TerminationReasonCategory = (typeof TERMINATION_REASON_CATEGORIES)[number];

export const TERMINATION_REASON_LABELS: Record<TerminationReasonCategory, string> = {
  RESIGNATION: "Resignation / quit",
  DISMISSAL_WITH_CAUSE: "Dismissal — with cause",
  DISMISSAL_WITHOUT_CAUSE: "Dismissal — without cause",
  LAYOFF_SHORTAGE_OF_WORK: "Layoff — shortage of work",
  END_OF_CONTRACT: "End of contract / season",
  RETIREMENT: "Retirement",
  OTHER: "Other",
};
