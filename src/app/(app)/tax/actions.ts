"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDays, addMonths, toUtcDay, utcDate } from "@/lib/dates";
import { PROVINCES, SYSTEM_ACCOUNTS, TAX_KINDS } from "@/lib/enums";
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
 * Where each kind of tax lands in the ledger. Sales tax is a liability until
 * remitted; GST/HST and QST paid on purchases are recoverable input credits,
 * while PST/RST is not — it stays in the expense (§7).
 */
const ACCOUNT_KEYS: Record<string, { liability: string; recoverable: string | null }> = {
  GST: { liability: SYSTEM_ACCOUNTS.GST_HST_PAYABLE, recoverable: SYSTEM_ACCOUNTS.GST_HST_RECOVERABLE },
  HST: { liability: SYSTEM_ACCOUNTS.GST_HST_PAYABLE, recoverable: SYSTEM_ACCOUNTS.GST_HST_RECOVERABLE },
  QST: { liability: SYSTEM_ACCOUNTS.QST_PAYABLE, recoverable: SYSTEM_ACCOUNTS.QST_RECOVERABLE },
  PST: { liability: SYSTEM_ACCOUNTS.PST_PAYABLE, recoverable: null },
  RST: { liability: SYSTEM_ACCOUNTS.PST_PAYABLE, recoverable: null },
};

/** "13" | "9.975" -> rate * 1_000_000, exactly, without touching a float. */
function toRateMicro(input: string): number {
  const raw = input.trim().replace("%", "");
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(raw)) {
    throw new Error(`"${input}" is not a valid rate. Use a percentage such as 13 or 9.975.`);
  }
  const [whole, frac = ""] = raw.split(".");
  return Number(BigInt(whole) * 10_000n + BigInt(frac.padEnd(4, "0")));
}

const componentSchema = z.object({
  kind: z.enum(TAX_KINDS),
  rate: z.string().min(1),
  compound: z.string().optional(),
});

const codeSchema = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and dashes only."),
  name: z.string().trim().min(2).max(80),
  jurisdiction: z.string().trim().min(2).max(2),
  effectiveFrom: z.string().min(10),
  treatment: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT"]),
  appliesTo: z.enum(["BOTH", "SALES", "PURCHASES"]),
});

export async function createTaxCodeAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.TAX_SETTINGS);
  const parsed = codeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the tax code details and try again." };
  }
  const input = parsed.data;
  const code = input.code.toUpperCase();

  const clash = await db.taxCode.findFirst({ where: { companyId: company.id, code } });
  if (clash) return { error: `Tax code ${code} already exists.` };

  // Component rows arrive as parallel kind/rate fields, one set per row.
  const components: { kind: string; rateMicro: number; compound: boolean }[] = [];
  if (input.treatment === "STANDARD") {
    const kinds = formData.getAll("kind");
    const rates = formData.getAll("rate");
    const compounds = formData.getAll("compound");
    for (let i = 0; i < kinds.length; i++) {
      const row = componentSchema.safeParse({
        kind: String(kinds[i] ?? ""),
        rate: String(rates[i] ?? ""),
        compound: String(compounds[i] ?? ""),
      });
      if (!row.success) continue;
      if (!row.data.rate.trim()) continue;
      try {
        const rateMicro = toRateMicro(row.data.rate);
        if (rateMicro === 0) continue;
        components.push({ kind: row.data.kind, rateMicro, compound: row.data.compound === "on" });
      } catch (error) {
        return { error: (error as Error).message };
      }
    }
    if (components.length === 0) {
      return { error: "A standard-rated code needs at least one component with a rate." };
    }
  }

  const accounts = await db.account.findMany({
    where: { companyId: company.id, systemKey: { not: null } },
    select: { id: true, systemKey: true },
  });
  const byKey = new Map(accounts.map((a) => [a.systemKey!, a.id]));

  for (const component of components) {
    const keys = ACCOUNT_KEYS[component.kind];
    if (!keys || !byKey.get(keys.liability)) {
      return { error: `This company has no ${component.kind} control account. Add it to the chart of accounts first.` };
    }
  }

  await db.taxCode.create({
    data: {
      companyId: company.id,
      code,
      name: input.name,
      jurisdiction: input.jurisdiction.toUpperCase(),
      isZeroRated: input.treatment === "ZERO_RATED",
      isExempt: input.treatment === "EXEMPT",
      appliesToSales: input.appliesTo !== "PURCHASES",
      appliesToPurchases: input.appliesTo !== "SALES",
      effectiveFrom: toUtcDay(input.effectiveFrom),
      components: {
        create: components.map((component, order) => {
          const keys = ACCOUNT_KEYS[component.kind];
          return {
            name: component.kind,
            kind: component.kind,
            rateMicro: component.rateMicro,
            isRecoverable: keys.recoverable !== null,
            compoundOnPrevious: component.compound,
            liabilityAccountId: byKey.get(keys.liability) ?? null,
            recoverableAccountId: keys.recoverable ? (byKey.get(keys.recoverable) ?? null) : null,
            sortOrder: order,
          };
        }),
      },
    },
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "CREATE",
    entityType: "TaxCode",
    summary: `Created tax code ${code} — ${input.name}`,
    metadata: { components },
  });

  revalidatePath("/tax/codes");
  revalidatePath("/tax");
  return { ok: true };
}

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
