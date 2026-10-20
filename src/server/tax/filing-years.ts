import "server-only";
import { db } from "@/lib/db";
import { today, utcDate } from "@/lib/dates";
import { recordAudit } from "@/server/auth/context";
import {
  filingLockMessage,
  filingYearLock,
  resolveFilingSelection,
  FILING_FREQUENCY_LABELS,
  type FilingFrequency,
} from "@/lib/tax-filing";

/** Canadian calendar year, taken from the server clock — never from the client. */
export function currentFilingYear(): number {
  return today().getUTCFullYear();
}

/**
 * The one writer of TaxFilingYear. Every path — the year-wise Tax Centre
 * section, the company profile, period generation — goes through here, so the
 * no-mid-year-change rule cannot be bypassed by choosing a different door.
 * There is deliberately no role or flag that skips the lock.
 */
export async function configureFilingYear(input: {
  companyId: string;
  userId: string;
  year: number;
  applicable: boolean;
  frequency: string | null | undefined;
}): Promise<{ ok: true; changed: boolean; frequency: FilingFrequency } | { error: string }> {
  const { companyId, userId, year } = input;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: "Choose a valid calendar year." };

  const resolved = resolveFilingSelection(input.applicable, input.frequency);
  if (!resolved.ok) return { error: resolved.error };
  const { applicable, frequency } = resolved.value;

  const existing = await db.taxFilingYear.findUnique({ where: { companyId_year: { companyId, year } } });
  const lock = filingYearLock(year, currentFilingYear(), Boolean(existing));
  if (lock !== "EDITABLE") {
    if (existing && existing.frequency === frequency && existing.applicable === applicable) {
      return { ok: true, changed: false, frequency };
    }
    return { error: filingLockMessage(lock, year) };
  }

  if (existing && existing.frequency === frequency && existing.applicable === applicable) {
    return { ok: true, changed: false, frequency };
  }

  // Periods already generated for the year must agree with the configuration;
  // otherwise the stored schedule would contradict the stated frequency.
  const periods = await db.taxPeriod.findMany({
    where: { companyId, startDate: { gte: utcDate(year, 1, 1) }, endDate: { lte: utcDate(year, 12, 31) } },
    select: { frequency: true },
  });
  if (periods.length > 0 && periods.some((p) => p.frequency !== frequency)) {
    return {
      error: `${year} already has ${periods[0].frequency.toLowerCase()} filing periods. Delete the open ones on the Filing periods page before changing the frequency.`,
    };
  }

  try {
    await db.taxFilingYear.upsert({
      where: { companyId_year: { companyId, year } },
      create: { companyId, year, applicable, frequency, createdById: userId },
      update: { applicable, frequency },
    });
  } catch (error) {
    // A concurrent first-time save of the same year hit the unique index: the
    // year is now configured, and for the current year that means final.
    if ((error as { code?: string }).code === "P2002") return { error: filingLockMessage("LOCKED_CURRENT", year) };
    throw error;
  }

  await recordAudit({
    companyId,
    userId,
    action: existing ? "UPDATE" : "CREATE",
    entityType: "TaxFilingYear",
    summary: `GST/HST filing for ${year} set to ${FILING_FREQUENCY_LABELS[frequency]}${existing ? ` (was ${FILING_FREQUENCY_LABELS[existing.frequency as FilingFrequency] ?? existing.frequency})` : ""}`,
    metadata: { year, applicable, frequency },
  });
  return { ok: true, changed: true, frequency };
}
