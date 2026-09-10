"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { employees, leaveTypes, leaveRequests, leaveBalanceAdjustments } from "@/server/db/hr";

const requestSchema = z.object({
  employeeId: z.string().min(1, "Choose an employee."),
  leaveTypeId: z.string().min(1, "Choose a leave type."),
  startDate: z.string().trim().min(1, "Start date is required."),
  endDate: z.string().trim().min(1, "End date is required."),
  hours: z.coerce.number().positive("Hours must be greater than zero.").max(10_000),
  reason: z.string().trim().max(500).optional(),
});

export async function createLeaveRequestAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const parsed = requestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the request details." };
  const input = parsed.data;

  const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
  const endDate = new Date(`${input.endDate}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return { error: "Check the dates." };
  if (endDate < startDate) return { error: "The end date cannot be before the start date." };

  const [employee, leaveType] = await Promise.all([
    employees.get(company.id, input.employeeId),
    leaveTypes.get(company.id, input.leaveTypeId),
  ]);
  if (!employee) return { error: "That employee does not exist in this company." };
  if (employee.employmentStatus === "TERMINATED") return { error: "This employee is terminated and cannot request leave." };
  if (!leaveType || !leaveType.isActive) return { error: "That leave type does not exist or is inactive." };

  const request = await leaveRequests.create({
    companyId: company.id,
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    startDate,
    endDate,
    hours: input.hours,
    reason: input.reason || null,
    status: "PENDING",
    requestedById: user.id,
  } as never);

  await recordAudit({
    companyId: company.id, userId: user.id, action: "CREATE", entityType: "LeaveRequest",
    entityId: request.id, summary: `Leave request added for ${employee.legalFirstName} ${employee.legalLastName} (${leaveType.name})`,
  });

  revalidatePath("/hr/time-off");
  return { ok: true as const };
}

const decisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["APPROVED", "DECLINED"]),
  decisionNote: z.string().trim().max(500).optional(),
});

export async function decideLeaveRequestAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const parsed = decisionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the decision details." };
  const input = parsed.data;

  const existing = await leaveRequests.get(company.id, input.id);
  if (!existing) return { error: "That leave request no longer exists." };
  if (existing.status !== "PENDING") return { error: "This request has already been decided." };
  const [reqEmployee, reqLeaveType] = await Promise.all([
    employees.get(company.id, existing.employeeId),
    leaveTypes.get(company.id, existing.leaveTypeId),
  ]);

  await leaveRequests.update(company.id, input.id, {
    status: input.decision,
    decidedById: user.id,
    decidedAt: new Date(),
    decisionNote: input.decisionNote || null,
  } as never);

  await recordAudit({
    companyId: company.id, userId: user.id, action: "UPDATE", entityType: "LeaveRequest",
    entityId: input.id,
    summary: `Leave request for ${reqEmployee?.legalFirstName ?? ""} ${reqEmployee?.legalLastName ?? ""} (${reqLeaveType?.name ?? "leave"}) ${input.decision.toLowerCase()}`,
  });

  revalidatePath("/hr/time-off");
  revalidatePath(`/hr/employees/${existing.employeeId}`);
  return { ok: true as const };
}

export async function cancelLeaveRequestAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing request id." };

  const existing = await leaveRequests.get(company.id, id);
  if (!existing) return { error: "That leave request no longer exists." };
  if (existing.status === "CANCELLED" || existing.status === "DECLINED") return { error: "This request cannot be cancelled." };
  const [reqEmployee, reqLeaveType] = await Promise.all([
    employees.get(company.id, existing.employeeId),
    leaveTypes.get(company.id, existing.leaveTypeId),
  ]);

  await leaveRequests.update(company.id, id, { status: "CANCELLED" });

  await recordAudit({
    companyId: company.id, userId: user.id, action: "UPDATE", entityType: "LeaveRequest",
    entityId: id, summary: `Leave request for ${reqEmployee?.legalFirstName ?? ""} ${reqEmployee?.legalLastName ?? ""} (${reqLeaveType?.name ?? "leave"}) cancelled`,
  });

  revalidatePath("/hr/time-off");
  revalidatePath(`/hr/employees/${existing.employeeId}`);
  return { ok: true as const };
}

const adjustmentSchema = z.object({
  employeeId: z.string().min(1, "Choose an employee."),
  leaveTypeId: z.string().min(1, "Choose a leave type."),
  hours: z.coerce.number().refine((v) => v !== 0, "Hours cannot be zero.").refine((v) => Math.abs(v) <= 10_000),
  reason: z.string().trim().min(1, "A reason is required.").max(500),
  effectiveDate: z.string().trim().min(1, "Effective date is required."),
});

/** A signed grant, carryover or correction to an employee's leave balance ledger. */
export async function addLeaveBalanceAdjustmentAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const parsed = adjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the adjustment details." };
  const input = parsed.data;

  const effectiveDate = new Date(`${input.effectiveDate}T00:00:00.000Z`);
  if (Number.isNaN(effectiveDate.getTime())) return { error: "Check the effective date." };

  const [employee, leaveType] = await Promise.all([
    employees.get(company.id, input.employeeId),
    leaveTypes.get(company.id, input.leaveTypeId),
  ]);
  if (!employee) return { error: "That employee does not exist in this company." };
  if (!leaveType || !leaveType.trackBalance) {
    return { error: "That leave type does not exist or does not track a balance." };
  }

  const adjustment = await leaveBalanceAdjustments.create({
    companyId: company.id,
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    hours: input.hours,
    reason: input.reason,
    effectiveDate,
    createdById: user.id,
  } as never);

  await recordAudit({
    companyId: company.id, userId: user.id, action: "CREATE", entityType: "LeaveBalanceAdjustment",
    entityId: adjustment.id,
    summary: `${input.hours > 0 ? "Granted" : "Deducted"} ${Math.abs(input.hours)}h of ${leaveType.name} for ${employee.legalFirstName} ${employee.legalLastName}. Reason: ${input.reason}`,
  });

  revalidatePath("/hr/time-off");
  revalidatePath(`/hr/employees/${input.employeeId}`);
  return { ok: true as const };
}
