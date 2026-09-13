"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDays, addMonths, toUtcDay, utcDate } from "@/lib/dates";
import { PROVINCES } from "@/lib/enums";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { setTaxPeriodStatus } from "@/server/reports/tax";
import { createProvincialTaxCodes } from "@/server/setup/provision";
import { PROVINCIAL_TAX_CODES } from "@/server/setup/templates";

// ── Filing periods ──────────────────────────────────────────────────────────

/**
 * A return walks one way: OPEN → REVIEW → FILED → CLOSED. Nothing may jump the
 * queue, and once a return has been filed with the CRA the only move left is to
 * lock it — un-filing a filed return in the books would put them out of step
 * with what was actually submitted.
 */
const FORWARD: Record<string, string> = {
  OPEN: "REVIEW",
  REVIEW: "FILED",
  FILED: "CLOSED",
};

const statusSchema = z.object({
  status: z.enum(["OPEN", "REVIEW", "FILED", "CLOSED"]),
  filingReference: z.string().max(60).optional(),
});

export async function setTaxPeriodStatusAction(
  periodId: string,
  status: string,
  filingReference?: string,
) {
  const { company, user } = await requireCapability(CAPABILITIES.TAX_FILING);
  const parsed = statusSchema.safeParse({ status, filingReference: filingReference || undefined });
  if (!parsed.success) return { error: "That is not a valid filing status." };

  const period = await db.taxPeriod.findFirst({ where: { id: periodId, companyId: company.id } });
  if (!period) return { error: "Tax period not found in this company." };
  if (period.status === status) return { ok: true };

  const isForward = FORWARD[period.status] === status;
  const isReopenFromReview = period.status === "REVIEW" && status === "OPEN";
  if (!isForward && !isReopenFromReview) {
    return {
      error:
        period.status === "CLOSED"
          ? `${period.name} is locked. A locked filing period cannot be changed.`
          : `${period.name} cannot go from ${period.status.toLowerCase()} to ${status.toLowerCase()}.`,
    };
  }

  try {
    await setTaxPeriodStatus(company.id, periodId, status, user.id, parsed.data.filingReference);
    revalidatePath("/tax");
    revalidatePath("/tax/periods");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const generateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
});

/**
 * Open a year's filing periods. Refuses to overlap periods that already exist —
 * two periods covering one date would double-count the same tax entry.
 */
export async function generateTaxPeriodsAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.TAX_FILING);
  const parsed = generateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Choose a year and a filing frequency." };

  const { year, frequency } = parsed.data;
  const yearStart = utcDate(year, 1, 1);
  const yearEnd = utcDate(year, 12, 31);

  const overlapping = await db.taxPeriod.count({
    where: { companyId: company.id, startDate: { lte: yearEnd }, endDate: { gte: yearStart } },
  });
  if (overlapping > 0) {
    return { error: `${year} already has filing periods. Delete the open ones first if the frequency changed.` };
  }

  const monthsPerPeriod = frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;
  const data = [];
  for (let i = 0; i < 12 / monthsPerPeriod; i++) {
    const startDate = utcDate(year, i * monthsPerPeriod + 1, 1);
    const endDate = addDays(addMonths(startDate, monthsPerPeriod), -1);
    const label =
      frequency === "QUARTERLY"
        ? `Q${i + 1} ${year}`
        : frequency === "ANNUAL"
          ? `${year}`
          : new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" }).format(startDate);
    data.push({
      companyId: company.id,
      name: `GST/HST ${label}`,
      startDate,
      endDate,
      frequency,
      status: "OPEN",
    });
  }

  await db.taxPeriod.createMany({ data });
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "CREATE",
    entityType: "TaxPeriod",
    summary: `Opened ${data.length} ${frequency.toLowerCase()} filing periods for ${year}`,
  });

  revalidatePath("/tax");
  revalidatePath("/tax/periods");
  return { ok: true, count: data.length };
}

/** Only an untouched, still-open period may be removed. */
export async function deleteTaxPeriodAction(periodId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.TAX_FILING);
  const period = await db.taxPeriod.findFirst({ where: { id: periodId, companyId: company.id } });
  if (!period) return { error: "Tax period not found in this company." };
  if (period.status !== "OPEN") return { error: `${period.name} is ${period.status.toLowerCase()} and cannot be deleted.` };

  const entries = await db.taxEntry.count({ where: { companyId: company.id, taxPeriodId: periodId } });
  if (entries > 0) {
    return { error: `${period.name} already has ${entries} tax entries posted into it.` };
  }

  await db.taxPeriod.delete({ where: { id: periodId } });
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "TaxPeriod",
    entityId: periodId,
    summary: `Deleted empty filing period ${period.name}`,
  });
  revalidatePath("/tax/periods");
  return { ok: true };
}

// ── Tax codes ───────────────────────────────────────────────────────────────

/**
 * Add the published codes for another province, from the invoice screen.
 *
 * Selling into a province the company has no code for is the common case for a
 * first out-of-province sale, and the alternative was making the user leave a
 * half-written invoice to go and hand-build a rate. This only ever materialises
 * a *published* template — it cannot invent a rate — and it skips codes that
 * already exist, so it can never overwrite one (§7).
 */
export async function addProvincialTaxCodesAction(province: string) {
  const { company, user } = await requireCapability(CAPABILITIES.TAX_SETTINGS);

  const code = String(province ?? "").toUpperCase();
  if (!PROVINCES.some((p) => p.code === code)) return { error: "Unknown province." };

  const available = PROVINCIAL_TAX_CODES[code] ?? [];
  if (available.length === 0) {
    // AB, NT, NU and YT levy no provincial sales tax — the federal GST code
    // every company already has is the correct answer there.
    return { error: `${code} has no provincial sales tax. Use the federal GST code.` };
  }

  try {
    const created = await db.$transaction((tx) => createProvincialTaxCodes(tx, company.id, code));
    if (created.length === 0) return { error: `The codes for ${code} already exist.` };

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "CREATE",
      entityType: "TaxCode",
      summary: `Added ${code} sales tax code${created.length === 1 ? "" : "s"}: ${created.map((c) => c.code).join(", ")}`,
      metadata: { province: code, codes: created.map((c) => c.code) },
    });

    revalidatePath("/tax/codes");
    revalidatePath("/sales/invoices/new");
    // The full specs go back so the invoice editor can offer the new codes
    // without a reload, which would cost the half-written document.
    return { ok: true, taxCodes: created };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Rates are never edited in place — a posted transaction keeps the rate that
 * was in force on its date (§7). Superseding a code end-dates it so nothing new
 * can use it while history still reads correctly.
 */
export async function endDateTaxCodeAction(taxCodeId: string, effectiveTo: string) {
  const { company, user } = await requireCapability(CAPABILITIES.TAX_SETTINGS);
  const code = await db.taxCode.findFirst({ where: { id: taxCodeId, companyId: company.id } });
  if (!code) return { error: "Tax code not found in this company." };
  if (!effectiveTo) return { error: "Choose the last day this code applies." };

  const end = toUtcDay(effectiveTo);
  if (end < code.effectiveFrom) return { error: "The end date cannot be before the code takes effect." };

  await db.taxCode.update({
    where: { id: taxCodeId },
    data: { effectiveTo: end, isDefaultSales: false, isDefaultPurchase: false },
  });
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "TaxCode",
    entityId: taxCodeId,
    summary: `Tax code ${code.code} end-dated ${effectiveTo}`,
  });

  revalidatePath("/tax/codes");
  return { ok: true };
}

export async function setTaxCodeActiveAction(taxCodeId: string, isActive: boolean) {
  const { company, user } = await requireCapability(CAPABILITIES.TAX_SETTINGS);
  const code = await db.taxCode.findFirst({ where: { id: taxCodeId, companyId: company.id } });
  if (!code) return { error: "Tax code not found in this company." };
  if (!isActive && (code.isDefaultSales || code.isDefaultPurchase)) {
    return { error: `${code.code} is a default code. Make another code the default first.` };
  }

  await db.taxCode.update({ where: { id: taxCodeId }, data: { isActive } });
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "TaxCode",
    entityId: taxCodeId,
    summary: `Tax code ${code.code} ${isActive ? "reactivated" : "archived"}`,
  });
  revalidatePath("/tax/codes");
  return { ok: true };
}

export async function setDefaultTaxCodeAction(taxCodeId: string, scope: "SALES" | "PURCHASES") {
  const { company, user } = await requireCapability(CAPABILITIES.TAX_SETTINGS);
  const code = await db.taxCode.findFirst({ where: { id: taxCodeId, companyId: company.id } });
  if (!code) return { error: "Tax code not found in this company." };
  if (!code.isActive) return { error: `${code.code} is archived and cannot be a default.` };
  if (scope === "SALES" && !code.appliesToSales) return { error: `${code.code} does not apply to sales.` };
  if (scope === "PURCHASES" && !code.appliesToPurchases) return { error: `${code.code} does not apply to purchases.` };

  const field = scope === "SALES" ? "isDefaultSales" : "isDefaultPurchase";
  await db.$transaction([
    db.taxCode.updateMany({ where: { companyId: company.id }, data: { [field]: false } }),
    db.taxCode.update({ where: { id: taxCodeId }, data: { [field]: true } }),
  ]);

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "TaxCode",
    entityId: taxCodeId,
    summary: `${code.code} is now the default ${scope.toLowerCase()} tax code`,
  });
  revalidatePath("/tax/codes");
  return { ok: true };
}
