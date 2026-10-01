"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { recordPlatformAudit } from "@/server/admin/audit";
import { cents, date, optionalStr, runAdminAction, str } from "@/server/admin/run-action";
import { findOverlappingStatutoryRate } from "@/server/payroll/tax-engine";

/**
 * CPP/CPP2/EI statutory rate mutations — same shape as
 * src/app/admin/(portal)/regional-tax-rates/actions.ts: every action runs
 * through runAdminAction (guard + CSRF), a published rate that has already
 * come into force is never rewritten (only ended), and every write requires a
 * reason for the audit log.
 */

/** "5.95" -> 5_950_000 (rateMicro). A percentage, not a fraction. */
function percentToRateMicro(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10_000);
}

/** "1.4" -> 1_400_000 (rateMicro). A multiplier, entered as-is (not a percentage). */
function multiplierToMicro(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000);
}

interface StatutoryRateInput {
  cppRateMicro: number;
  cppBasicExemptionCents: number;
  cppMaxPensionableEarningsCents: number;
  cpp2RateMicro: number;
  cpp2MaxPensionableEarningsCents: number;
  eiRateMicro: number;
  eiRateMicroQuebec: number;
  eiEmployerMultiplierMicro: number;
  eiMaxInsurableEarningsCents: number;
  qpipRateMicro: number;
  qpipEmployerRateMicro: number;
  qpipMaxInsurableEarningsCents: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

function readInput(formData: FormData): { input: StatutoryRateInput | null; error: string | null } {
  const cppRateMicro = percentToRateMicro(str(formData, "cppRate"));
  const cppBasicExemptionCents = cents(formData, "cppBasicExemption");
  const cppMaxPensionableEarningsCents = cents(formData, "cppMaxPensionableEarnings");
  const cpp2RateMicro = percentToRateMicro(str(formData, "cpp2Rate"));
  const cpp2MaxPensionableEarningsCents = cents(formData, "cpp2MaxPensionableEarnings");
  const eiRateMicro = percentToRateMicro(str(formData, "eiRate"));
  const eiRateMicroQuebec = percentToRateMicro(str(formData, "eiRateQuebec"));
  const eiEmployerMultiplierMicro = multiplierToMicro(str(formData, "eiEmployerMultiplier"));
  const eiMaxInsurableEarningsCents = cents(formData, "eiMaxInsurableEarnings");
  const qpipRateMicro = percentToRateMicro(str(formData, "qpipRate"));
  const qpipEmployerRateMicro = percentToRateMicro(str(formData, "qpipEmployerRate"));
  const qpipMaxInsurableEarningsCents = cents(formData, "qpipMaxInsurableEarnings");
  const effectiveFrom = date(formData, "effectiveFrom");
  const effectiveTo = date(formData, "effectiveTo");

  if (cppRateMicro === null) return { input: null, error: "Enter the CPP rate as a percentage." };
  if (cppBasicExemptionCents === null) return { input: null, error: "Enter the CPP basic exemption." };
  if (cppMaxPensionableEarningsCents === null) return { input: null, error: "Enter the CPP maximum pensionable earnings (YMPE)." };
  if (cpp2RateMicro === null) return { input: null, error: "Enter the CPP2 rate as a percentage." };
  if (cpp2MaxPensionableEarningsCents === null) return { input: null, error: "Enter the CPP2 maximum pensionable earnings (YAMPE)." };
  if (eiRateMicro === null) return { input: null, error: "Enter the EI rate as a percentage." };
  if (eiRateMicroQuebec === null) return { input: null, error: "Enter Quebec's EI rate as a percentage." };
  if (eiEmployerMultiplierMicro === null) return { input: null, error: "Enter the EI employer multiplier (e.g. 1.4)." };
  if (eiMaxInsurableEarningsCents === null) return { input: null, error: "Enter the EI maximum insurable earnings." };
  if (qpipRateMicro === null) return { input: null, error: "Enter the QPIP employee rate as a percentage." };
  if (qpipEmployerRateMicro === null) return { input: null, error: "Enter the QPIP employer rate as a percentage." };
  if (qpipMaxInsurableEarningsCents === null) return { input: null, error: "Enter QPIP's maximum insurable earnings." };
  if (!effectiveFrom) return { input: null, error: "Effective date is required." };
  if (cpp2MaxPensionableEarningsCents <= cppMaxPensionableEarningsCents) {
    return { input: null, error: "CPP2's maximum (YAMPE) must be greater than CPP's maximum (YMPE)." };
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) return { input: null, error: "The expiry date must be after the effective date." };

  return {
    input: {
      cppRateMicro, cppBasicExemptionCents, cppMaxPensionableEarningsCents,
      cpp2RateMicro, cpp2MaxPensionableEarningsCents,
      eiRateMicro, eiRateMicroQuebec, eiEmployerMultiplierMicro, eiMaxInsurableEarningsCents,
      qpipRateMicro, qpipEmployerRateMicro, qpipMaxInsurableEarningsCents,
      effectiveFrom, effectiveTo,
    },
    error: null,
  };
}

function summarise(input: StatutoryRateInput): string {
  return `CPP ${(input.cppRateMicro / 10_000).toString()}%, CPP2 ${(input.cpp2RateMicro / 10_000).toString()}%, EI ${(input.eiRateMicro / 10_000).toString()}% (QC ${(input.eiRateMicroQuebec / 10_000).toString()}%), QPIP ${(input.qpipRateMicro / 10_000).toString()}%`;
}

export async function createStatutoryRateAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const { input, error } = readInput(formData);
    if (error || !input) return { error: error ?? "Check the rate details." };

    const overlap = await findOverlappingStatutoryRate(input);
    if (overlap) {
      return {
        error: `This overlaps an existing statutory rate (effective ${overlap.effectiveFrom.toISOString().slice(0, 10)}` +
          `${overlap.effectiveTo ? ` to ${overlap.effectiveTo.toISOString().slice(0, 10)}` : ", ongoing"}). ` +
          `Only one CPP/CPP2/EI rate can be in force at a time.`,
      };
    }

    const reason = optionalStr(formData, "reason") ?? null;
    if (!reason) return { error: "A reason is required to publish a rate change." };

    const created = await db.payrollStatutoryRate.create({
      data: { ...input, isActive: true, createdById: actor.id, reason },
    });

    await recordPlatformAudit({
      actorUserId: actor.id, actorEmail: actor.email, action: "CREATE", entityType: "PayrollStatutoryRate",
      entityId: created.id, summary: `Payroll statutory rate added — ${summarise(input)}, effective ${input.effectiveFrom.toISOString().slice(0, 10)}`,
      reason, after: created,
    });

    revalidatePath("/admin/payroll-rates/statutory");
    return { ok: true, message: "Rate added." };
  });
}

export async function updateStatutoryRateAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    if (!id) return { error: "Missing rate id." };

    const existing = await db.payrollStatutoryRate.findUnique({ where: { id } });
    if (!existing) return { error: "That rate no longer exists." };
    if (existing.effectiveFrom <= new Date()) {
      return { error: "This rate is already in effect and cannot be edited. End it and add a new rate instead." };
    }

    const { input, error } = readInput(formData);
    if (error || !input) return { error: error ?? "Check the rate details." };

    const overlap = await findOverlappingStatutoryRate(input, id);
    if (overlap) return { error: "This overlaps another existing statutory rate." };

    const reason = optionalStr(formData, "reason") ?? null;
    if (!reason) return { error: "A reason is required to publish a rate change." };

    const updated = await db.payrollStatutoryRate.update({ where: { id }, data: { ...input, reason } });

    await recordPlatformAudit({
      actorUserId: actor.id, actorEmail: actor.email, action: "UPDATE", entityType: "PayrollStatutoryRate",
      entityId: id, summary: `Unpublished payroll statutory rate updated — ${summarise(input)}`, reason, before: existing, after: updated,
    });

    revalidatePath("/admin/payroll-rates/statutory");
    return { ok: true, message: "Rate updated." };
  });
}

export async function endStatutoryRateAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    const effectiveTo = date(formData, "effectiveTo");
    const reason = optionalStr(formData, "reason") ?? null;
    if (!id) return { error: "Missing rate id." };
    if (!effectiveTo) return { error: "Choose the date this rate stops applying." };
    if (!reason) return { error: "Give a reason for ending this rate." };

    const existing = await db.payrollStatutoryRate.findUnique({ where: { id } });
    if (!existing) return { error: "That rate no longer exists." };
    if (effectiveTo <= existing.effectiveFrom) return { error: "The end date must be after the rate's effective date." };

    const updated = await db.payrollStatutoryRate.update({ where: { id }, data: { effectiveTo, reason } });

    await recordPlatformAudit({
      actorUserId: actor.id, actorEmail: actor.email, action: "UPDATE", entityType: "PayrollStatutoryRate",
      entityId: id, summary: `Payroll statutory rate ended, ends ${effectiveTo.toISOString().slice(0, 10)}`, reason, before: existing, after: updated,
    });

    revalidatePath("/admin/payroll-rates/statutory");
    return { ok: true, message: "Rate end date set." };
  });
}

export async function deleteStatutoryRateAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const id = str(formData, "id");
    const reason = optionalStr(formData, "reason") ?? null;
    if (!id) return { error: "Missing rate id." };
    if (!reason) return { error: "Give a reason for deleting this rate." };

    const existing = await db.payrollStatutoryRate.findUnique({ where: { id } });
    if (!existing) return { error: "That rate no longer exists." };
    if (existing.effectiveFrom <= new Date()) {
      return { error: "This rate is already in effect and cannot be deleted. End it instead — that keeps the history intact." };
    }

    await db.payrollStatutoryRate.delete({ where: { id } });

    await recordPlatformAudit({
      actorUserId: actor.id, actorEmail: actor.email, action: "DELETE", entityType: "PayrollStatutoryRate",
      entityId: id, summary: "Unpublished payroll statutory rate deleted", reason, before: existing,
    });

    revalidatePath("/admin/payroll-rates/statutory");
    return { ok: true, message: "Rate deleted." };
  });
}
