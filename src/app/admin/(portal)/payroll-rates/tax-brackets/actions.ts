"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { PROVINCES } from "@/lib/enums";
import { recordPlatformAudit } from "@/server/admin/audit";
import { cents, date, optionalStr, runAdminAction, str } from "@/server/admin/run-action";
import { findOverlappingBracket } from "@/server/payroll/tax-engine";

/**
 * Marginal income-tax bracket mutations — one row per bracket. Several rows
 * share a (jurisdiction, effectiveFrom) group to form a full bracket set; see
 * PayrollTaxBracket's schema comment. Same shape as the other rate admin
 * screens: a published bracket is never rewritten, only ended; every write
 * needs a reason.
 */

const JURISDICTIONS = ["FEDERAL", ...PROVINCES.map((p) => p.code)];

interface BracketInput {
  jurisdiction: string;
  minCents: number;
  maxCents: number | null;
  rateMicro: number;
  basicPersonalAmountCents: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

function percentToRateMicro(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10_000);
}

function readInput(formData: FormData): { input: BracketInput | null; error: string | null } {
  const jurisdiction = str(formData, "jurisdiction").toUpperCase();
  const minCents = cents(formData, "min") ?? 0;
  const maxRaw = str(formData, "max");
  const maxCents = maxRaw ? cents(formData, "max") : null;
  const rateMicro = percentToRateMicro(str(formData, "rate"));
  const basicPersonalAmountCents = cents(formData, "basicPersonalAmount");
  const effectiveFrom = date(formData, "effectiveFrom");
  const effectiveTo = date(formData, "effectiveTo");

  if (!JURISDICTIONS.includes(jurisdiction)) return { input: null, error: "Choose a valid jurisdiction." };
  if (rateMicro === null) return { input: null, error: "Enter this bracket's rate as a percentage." };
  if (basicPersonalAmountCents === null) return { input: null, error: "Enter the basic personal amount for this jurisdiction/year." };
  if (!effectiveFrom) return { input: null, error: "Effective date is required." };
  if (maxCents !== null && maxCents <= minCents) return { input: null, error: "The bracket's upper bound must be greater than its lower bound." };
  if (effectiveTo && effectiveTo <= effectiveFrom) return { input: null, error: "The expiry date must be after the effective date." };

  return { input: { jurisdiction, minCents, maxCents, rateMicro, basicPersonalAmountCents, effectiveFrom, effectiveTo }, error: null };
}

function summarise(input: BracketInput): string {
  const top = input.maxCents !== null ? `$${(input.maxCents / 100).toLocaleString("en-CA")}` : "and up";
  return `${input.jurisdiction} $${(input.minCents / 100).toLocaleString("en-CA")}–${top} @ ${(input.rateMicro / 10_000).toString()}%`;
}

export async function createBracketAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const { input, error } = readInput(formData);
    if (error || !input) return { error: error ?? "Check the bracket details." };

    const overlap = await findOverlappingBracket(input);
    if (overlap) {
      return { error: `This overlaps an existing bracket set for ${input.jurisdiction} covering the same effective period.` };
    }

    const reason = optionalStr(formData, "reason") ?? null;
    if (!reason) return { error: "A reason is required to publish a bracket change." };

    const created = await db.payrollTaxBracket.create({ data: { ...input, isActive: true, createdById: actor.id, reason } });

    await recordPlatformAudit({
      actorUserId: actor.id, actorEmail: actor.email, action: "CREATE", entityType: "PayrollTaxBracket",
      entityId: created.id, summary: `Payroll tax bracket added — ${summarise(input)}`, reason, after: created,
    });

    revalidatePath("/admin/payroll-rates/tax-brackets");
    return { ok: true, message: "Bracket added." };
  });
}

export async function updateBracketAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    if (!id) return { error: "Missing bracket id." };

    const existing = await db.payrollTaxBracket.findUnique({ where: { id } });
    if (!existing) return { error: "That bracket no longer exists." };
    if (existing.effectiveFrom <= new Date()) {
      return { error: "This bracket is already in effect and cannot be edited. End it and add a new one instead." };
    }

    const { input, error } = readInput(formData);
    if (error || !input) return { error: error ?? "Check the bracket details." };

    const overlap = await findOverlappingBracket(input, id);
    if (overlap) return { error: `This overlaps another existing bracket for ${input.jurisdiction}.` };

    const reason = optionalStr(formData, "reason") ?? null;
    if (!reason) return { error: "A reason is required to publish a bracket change." };

    const updated = await db.payrollTaxBracket.update({ where: { id }, data: { ...input, reason } });

    await recordPlatformAudit({
      actorUserId: actor.id, actorEmail: actor.email, action: "UPDATE", entityType: "PayrollTaxBracket",
      entityId: id, summary: `Unpublished payroll tax bracket updated — ${summarise(input)}`, reason, before: existing, after: updated,
    });

    revalidatePath("/admin/payroll-rates/tax-brackets");
    return { ok: true, message: "Bracket updated." };
  });
}

export async function endBracketAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    const effectiveTo = date(formData, "effectiveTo");
    const reason = optionalStr(formData, "reason") ?? null;
    if (!id) return { error: "Missing bracket id." };
    if (!effectiveTo) return { error: "Choose the date this bracket stops applying." };
    if (!reason) return { error: "Give a reason for ending this bracket." };

    const existing = await db.payrollTaxBracket.findUnique({ where: { id } });
    if (!existing) return { error: "That bracket no longer exists." };
    if (effectiveTo <= existing.effectiveFrom) return { error: "The end date must be after the bracket's effective date." };

    const updated = await db.payrollTaxBracket.update({ where: { id }, data: { effectiveTo, reason } });

    await recordPlatformAudit({
      actorUserId: actor.id, actorEmail: actor.email, action: "UPDATE", entityType: "PayrollTaxBracket",
      entityId: id, summary: `Payroll tax bracket ended, ends ${effectiveTo.toISOString().slice(0, 10)}`, reason, before: existing, after: updated,
    });

    revalidatePath("/admin/payroll-rates/tax-brackets");
    return { ok: true, message: "Bracket end date set." };
  });
}

export async function deleteBracketAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    const reason = optionalStr(formData, "reason") ?? null;
    if (!id) return { error: "Missing bracket id." };
    if (!reason) return { error: "Give a reason for deleting this bracket." };

    const existing = await db.payrollTaxBracket.findUnique({ where: { id } });
    if (!existing) return { error: "That bracket no longer exists." };
    if (existing.effectiveFrom <= new Date()) {
      return { error: "This bracket is already in effect and cannot be deleted. End it instead — that keeps the history intact." };
    }

    await db.payrollTaxBracket.delete({ where: { id } });

    await recordPlatformAudit({
      actorUserId: actor.id, actorEmail: actor.email, action: "DELETE", entityType: "PayrollTaxBracket",
      entityId: id, summary: `Unpublished payroll tax bracket deleted — ${summarise(existing as unknown as BracketInput)}`, reason, before: existing,
    });

    revalidatePath("/admin/payroll-rates/tax-brackets");
    return { ok: true, message: "Bracket deleted." };
  });
}
