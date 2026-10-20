/**
 * GST/HST filing-frequency rules, kept pure so the server action, the UI and
 * the acceptance checks all apply exactly the same logic.
 *
 * Finalisation: a calendar year's configuration is final from the moment the
 * year has begun. A year that has not started yet is editable; the current
 * year may be configured once if it has no configuration at all (a new
 * company's first setup) and is then final; past years are never editable.
 * There is no role that bypasses this.
 */

export const FILING_FREQUENCIES = ["EXEMPT", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type FilingFrequency = (typeof FILING_FREQUENCIES)[number];

export const FILING_FREQUENCY_LABELS: Record<FilingFrequency, string> = {
  EXEMPT: "Exempt / Not applicable",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annually",
};

/** How many calendar years ahead of today can be pre-configured. */
export const FILING_YEARS_AHEAD = 5;

export type YearLock = "EDITABLE" | "LOCKED_CURRENT" | "LOCKED_PAST" | "NOT_YET_OPEN";

export interface FilingSelection {
  applicable: boolean;
  frequency: FilingFrequency;
}

export function isFilingFrequency(value: unknown): value is FilingFrequency {
  return typeof value === "string" && (FILING_FREQUENCIES as readonly string[]).includes(value);
}

/**
 * Resolve a submitted (applicable, frequency) pair. Not applicable forces
 * Exempt; applicable requires a real frequency. Contradictions are rejected
 * rather than silently "fixed" when the caller actually supplied one.
 */
export function resolveFilingSelection(
  applicable: boolean,
  frequency: string | null | undefined,
): { ok: true; value: FilingSelection } | { ok: false; error: string } {
  if (!applicable) {
    if (frequency && frequency !== "EXEMPT") {
      return { ok: false, error: "GST/HST is marked Not applicable, so the filing frequency can only be Exempt." };
    }
    return { ok: true, value: { applicable: false, frequency: "EXEMPT" } };
  }
  if (!isFilingFrequency(frequency) || frequency === "EXEMPT") {
    return { ok: false, error: "Choose Monthly, Quarterly or Annually for a GST/HST filer." };
  }
  return { ok: true, value: { applicable: true, frequency } };
}

/**
 * Whether `year`'s configuration may be written now.
 * `exists` is whether a configuration row is already stored for that year.
 */
export function filingYearLock(year: number, currentYear: number, exists: boolean): YearLock {
  if (year > currentYear + FILING_YEARS_AHEAD) return "NOT_YET_OPEN";
  if (year > currentYear) return "EDITABLE";
  if (year === currentYear) return exists ? "LOCKED_CURRENT" : "EDITABLE";
  return "LOCKED_PAST";
}

export function filingLockMessage(lock: YearLock, year: number): string {
  switch (lock) {
    case "LOCKED_CURRENT":
      return `${year} is the current calendar year and its filing frequency is final. It cannot be changed mid-year; configure a future year instead.`;
    case "LOCKED_PAST":
      return `${year} is a past calendar year. Its filing configuration is part of the historical record and cannot be changed.`;
    case "NOT_YET_OPEN":
      return `${year} is too far ahead to configure yet.`;
    default:
      return "";
  }
}
