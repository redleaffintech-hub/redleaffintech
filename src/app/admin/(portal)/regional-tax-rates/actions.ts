"use server";

import { revalidatePath } from "next/cache";
import { PROVINCES } from "@/lib/enums";
import { regionalTaxRates } from "@/server/db/platform";
import { recordPlatformAudit } from "@/server/admin/audit";
import { bool, date, optionalStr, runAdminAction, str } from "@/server/admin/run-action";
import {
  combinedRateMicro,
  findOverlappingRate,
  validateRegionalRateShape,
  type RegionalRateInput,
} from "@/server/tax/regional-rates";

/**
 * Regional tax rate mutations.
 *
 * Every action runs through `runAdminAction`, which is the platform-admin
 * authorisation boundary (guard + CSRF) — see src/server/admin/run-action.ts.
 * Nothing here is reachable without a live, unsuspended platform-admin session.
 *
 * The one rule everything below exists to enforce: a rate that has already
 * come into force is never rewritten. `updateRateAction` refuses to touch a
 * row whose `effectiveFrom` is not still in the future, checked fresh against
 * the database rather than trusting whatever the form was rendered with — the
 * only way to change a published regime is `endRateAction` (close its range)
 * plus a new row.
 */

const PROVINCE_LABEL: Map<string, string> = new Map(PROVINCES.map((p) => [p.code, p.name]));

/** "7.5" -> 75000 (rateMicro). Percent, not a fraction — matches what the form shows. */
function percentToRateMicro(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10_000);
}

function readRateInput(formData: FormData): { input: RegionalRateInput; error: string | null } {
  const province = str(formData, "province").toUpperCase();
  const federalType = str(formData, "federalType").toUpperCase();
  const provincialType = str(formData, "provincialType").toUpperCase();
  const federalRateMicro = percentToRateMicro(str(formData, "federalRate"));
  const provincialRateMicro = provincialType === "NONE" ? 0 : percentToRateMicro(str(formData, "provincialRate"));
  const effectiveFrom = date(formData, "effectiveFrom");
  const effectiveTo = date(formData, "effectiveTo");

  if (federalRateMicro === null) return { input: null as never, error: "Enter the GST/HST rate as a percentage." };
  if (provincialRateMicro === null) return { input: null as never, error: "Enter the provincial tax rate as a percentage." };
  if (!effectiveFrom) return { input: null as never, error: "Effective date is required." };

  return {
    input: { province, federalType, federalRateMicro, provincialType, provincialRateMicro, effectiveFrom, effectiveTo },
    error: null,
  };
}

function summariseRate(input: RegionalRateInput): string {
  const region = PROVINCE_LABEL.get(input.province) ?? input.province;
  const parts = [`${input.federalType} ${(input.federalRateMicro / 10_000).toString()}%`];
  if (input.provincialType !== "NONE") parts.push(`${input.provincialType} ${(input.provincialRateMicro / 10_000).toString()}%`);
  return `${region}: ${parts.join(" + ")}`;
}

export async function createRateAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const { input, error } = readRateInput(formData);
    if (error) return { error };

    const shapeError = validateRegionalRateShape(input);
    if (shapeError) return { error: shapeError };

    const overlap = await findOverlappingRate(input);
    if (overlap) {
      return {
        error: `This overlaps an existing rate for ${PROVINCE_LABEL.get(input.province) ?? input.province} ` +
          `(effective ${overlap.effectiveFrom.toISOString().slice(0, 10)}` +
          `${overlap.effectiveTo ? ` to ${overlap.effectiveTo.toISOString().slice(0, 10)}` : ", ongoing"}). ` +
          `Effective ranges for the same region cannot overlap.`,
      };
    }

    const reason = optionalStr(formData, "reason") ?? null;
    if (!reason) return { error: "A reason is required to publish a rate change." };

    const created = await regionalTaxRates.create({
      province: input.province,
      federalType: input.federalType,
      federalRateMicro: input.federalRateMicro,
      provincialType: input.provincialType,
      provincialRateMicro: input.provincialRateMicro,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      isActive: true,
      createdById: actor.id,
      reason,
    });

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: "CREATE",
      entityType: "RegionalTaxRate",
      entityId: created.id,
      summary: `Regional tax rate added — ${summariseRate(input)}, effective ${input.effectiveFrom.toISOString().slice(0, 10)}`,
      reason,
      after: created,
    });

    revalidatePath("/admin/regional-tax-rates");
    return { ok: true, message: "Rate added." };
  });
}

export async function updateRateAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    if (!id) return { error: "Missing rate id." };

    const existing = await regionalTaxRates.get(id);
    if (!existing) return { error: "That rate no longer exists." };

    // The only real control in this whole action: re-checked against the
    // database, not the value the edit form happened to be rendered with, so a
    // stale tab cannot slip an edit through after the rate has come into force.
    if (existing.effectiveFrom <= new Date()) {
      return { error: "This rate is already in effect and cannot be edited. End it and add a new rate instead." };
    }

    const { input, error } = readRateInput(formData);
    if (error) return { error };

    const shapeError = validateRegionalRateShape(input);
    if (shapeError) return { error: shapeError };

    const overlap = await findOverlappingRate(input, id);
    if (overlap) {
      return {
        error: `This overlaps another existing rate for ${PROVINCE_LABEL.get(input.province) ?? input.province}.`,
      };
    }

    const reason = optionalStr(formData, "reason") ?? null;
    if (!reason) return { error: "A reason is required to publish a rate change." };

    await regionalTaxRates.update(id, {
      province: input.province,
      federalType: input.federalType,
      federalRateMicro: input.federalRateMicro,
      provincialType: input.provincialType,
      provincialRateMicro: input.provincialRateMicro,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      reason,
    });
    const updated = (await regionalTaxRates.get(id)) ?? existing;

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: "UPDATE",
      entityType: "RegionalTaxRate",
      entityId: id,
      summary: `Unpublished regional tax rate updated — ${summariseRate(input)}`,
      reason,
      before: existing,
      after: updated,
    });

    revalidatePath("/admin/regional-tax-rates");
    return { ok: true, message: "Rate updated." };
  });
}

/** Close a rate's range as of a date, rather than deleting or rewriting it. */
export async function endRateAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    const effectiveTo = date(formData, "effectiveTo");
    const reason = optionalStr(formData, "reason") ?? null;
    if (!id) return { error: "Missing rate id." };
    if (!effectiveTo) return { error: "Choose the date this rate stops applying." };
    if (!reason) return { error: "Give a reason for ending this rate." };

    const existing = await regionalTaxRates.get(id);
    if (!existing) return { error: "That rate no longer exists." };
    if (effectiveTo <= existing.effectiveFrom) return { error: "The end date must be after the rate's effective date." };

    await regionalTaxRates.update(id, { effectiveTo, reason });
    const updated = (await regionalTaxRates.get(id)) ?? existing;

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: "UPDATE",
      entityType: "RegionalTaxRate",
      entityId: id,
      summary: `Regional tax rate ended — ${summariseRate(existing as unknown as RegionalRateInput)}, ends ${effectiveTo.toISOString().slice(0, 10)}`,
      reason,
      before: existing,
      after: updated,
    });

    revalidatePath("/admin/regional-tax-rates");
    return { ok: true, message: "Rate end date set." };
  });
}

export async function setRateActiveAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    const isActive = bool(formData, "isActive");
    const reason = optionalStr(formData, "reason") ?? null;
    if (!id) return { error: "Missing rate id." };

    const existing = await regionalTaxRates.get(id);
    if (!existing) return { error: "That rate no longer exists." };

    await regionalTaxRates.update(id, { isActive });
    const updated = (await regionalTaxRates.get(id)) ?? existing;

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: "UPDATE",
      entityType: "RegionalTaxRate",
      entityId: id,
      summary: `Regional tax rate ${isActive ? "activated" : "deactivated"} — ${summariseRate(existing as unknown as RegionalRateInput)}`,
      reason,
      before: existing,
      after: updated,
    });

    revalidatePath("/admin/regional-tax-rates");
    return { ok: true, message: isActive ? "Rate activated." : "Rate deactivated." };
  });
}

export { combinedRateMicro };
