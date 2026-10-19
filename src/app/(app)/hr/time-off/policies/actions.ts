"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { EMPLOYEE_TYPES } from "@/lib/hr-enums";
import { syncLeaveLedger } from "@/server/hr/leave-policy";

const optionalNumber = (min: number, max: number) =>
  z.union([z.literal(""), z.coerce.number().min(min).max(max)]).optional();

const policySchema = z.object({
  leaveTypeId: z.string().min(1, "Choose a leave type."),
  entitlementUnit: z.enum(["WEEKS", "DAYS", "HOURS"], { message: "Choose weeks, days or hours." }),
  entitlementAmount: z.coerce.number({ message: "Enter the annual entitlement." }).min(0, "The entitlement cannot be negative.").max(10_000),
  hoursPerDay: z.coerce.number().min(0.5, "Hours per day must be at least 0.5.").max(24).default(8),
  daysPerWeek: z.coerce.number().min(1, "Days per week must be at least 1.").max(7).default(5),
  accrualMethod: z.enum(["FRONT_LOADED", "ACCRUED"]),
  leaveYearStartMonth: z.coerce.number().int().min(1).max(12),
  waitingPeriodDays: z.coerce.number().int().min(0).max(730).default(0),
  prorationMethod: z.enum(["DAYS", "MONTHS", "NONE"]),
  carryForwardMaxHours: optionalNumber(0, 10_000),
  carryForwardExpiryMonths: optionalNumber(1, 36),
  excessHandling: z.enum(["FORFEIT", "PAYOUT"]),
});

export async function saveLeavePolicyAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);

  const parsed = policySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the policy details." };
  const input = parsed.data;

  const eligible = formData.getAll("eligibleEmployeeTypes").map(String).filter((t) => (EMPLOYEE_TYPES as readonly string[]).includes(t));
  if (eligible.length === 0) return { error: "Choose at least one employee type the policy applies to." };

  const leaveType = await db.leaveType.findFirst({ where: { id: input.leaveTypeId, companyId: company.id, trackBalance: true } });
  if (!leaveType) return { error: "That leave type does not exist or does not track a balance." };

  const carryForwardEnabled = formData.get("carryForwardEnabled") === "on";
  const data = {
    isActive: formData.get("isActive") === "on",
    entitlementUnit: input.entitlementUnit,
    entitlementAmount: input.entitlementAmount,
    hoursPerDay: input.hoursPerDay,
    daysPerWeek: input.daysPerWeek,
    accrualMethod: input.accrualMethod,
    leaveYearStartMonth: input.leaveYearStartMonth,
    eligibleEmployeeTypes: eligible.join(","),
    waitingPeriodDays: input.waitingPeriodDays,
    prorationMethod: input.prorationMethod,
    carryForwardEnabled,
    carryForwardMaxHours: carryForwardEnabled && input.carryForwardMaxHours !== "" && input.carryForwardMaxHours !== undefined ? Number(input.carryForwardMaxHours) : null,
    carryForwardExpiryMonths: carryForwardEnabled && input.carryForwardExpiryMonths !== "" && input.carryForwardExpiryMonths !== undefined ? Math.round(Number(input.carryForwardExpiryMonths)) : null,
    excessHandling: input.excessHandling,
  };

  const existing = await db.leavePolicy.findUnique({ where: { leaveTypeId: leaveType.id } });
  const policy = existing
    ? await db.leavePolicy.update({ where: { id: existing.id }, data })
    : await db.leavePolicy.create({ data: { companyId: company.id, leaveTypeId: leaveType.id, ...data } });

  await recordAudit({
    companyId: company.id, userId: user.id, action: existing ? "UPDATE" : "CREATE", entityType: "LeavePolicy", entityId: policy.id,
    summary: `${existing ? "Updated" : "Created"} ${leaveType.name} leave policy: ${input.entitlementAmount} ${input.entitlementUnit.toLowerCase()} per leave year, ${
      carryForwardEnabled ? `carry-forward on${data.carryForwardMaxHours != null ? ` (max ${data.carryForwardMaxHours}h)` : ""}` : "carry-forward off"
    }`,
  });

  revalidatePath("/hr/time-off", "layout");
  return { ok: true as const };
}

/** Writes any carry-forward / expiry records now due. Safe to run repeatedly. */
export async function runLeaveYearEndAction() {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const result = await syncLeaveLedger(company.id, user.id);
  if (result.carried > 0 || result.expired > 0) {
    await recordAudit({
      companyId: company.id, userId: user.id, action: "UPDATE", entityType: "LeaveBalanceAdjustment", entityId: company.id,
      summary: `Leave year-end processing: ${result.carried} carry-forward entr${result.carried === 1 ? "y" : "ies"}, ${result.expired} expiry record${result.expired === 1 ? "" : "s"}`,
    });
  }
  revalidatePath("/hr/time-off", "layout");
  revalidatePath("/hr/employees", "layout");
  return { ok: true as const, ...result };
}
