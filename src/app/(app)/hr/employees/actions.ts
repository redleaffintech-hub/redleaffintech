"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PROVINCES } from "@/lib/enums";
import {
  COMPENSATION_TYPES,
  EMPLOYEE_TYPES,
  PAY_FREQUENCIES,
  TERMINATION_REASON_CATEGORIES,
} from "@/lib/hr-enums";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { isValidSin, normalizeSin, sinLastThree } from "@/server/hr/employment-standards";
import { departments, employees } from "@/server/db/hr";
import { bumpSequenceTx } from "@/server/db/companies";
import { runTransaction } from "@/server/db/firestore";

/**
 * Employee record mutations.
 *
 * A SIN is never stored reversibly (§ employment-standards.ts): only the last
 * three digits and a SHA-256 fingerprint are kept, so an edit that leaves the
 * SIN field blank must leave the stored value untouched rather than clearing
 * it — there is nothing to "re-save" a blank over.
 */

const provinceCodes = PROVINCES.map((p) => p.code);

const optionalText = (max: number) =>
  z.string().max(max).transform((v) => v.trim()).transform((v) => (v === "" ? null : v)).nullable().optional();

const optionalProvince = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .refine((v) => !v || provinceCodes.includes(v as (typeof provinceCodes)[number]), {
    message: "Choose a Canadian province or territory.",
  });

const requiredProvince = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => provinceCodes.includes(v as (typeof provinceCodes)[number]), {
    message: "Choose a Canadian province or territory of employment.",
  });

const optionalDate = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v === "" ? null : new Date(`${v}T00:00:00.000Z`)))
  .nullable()
  .optional();

const employeeSchema = z.object({
  legalFirstName: z.string().trim().min(1, "First name is required.").max(80),
  legalLastName: z.string().trim().min(1, "Last name is required.").max(80),
  preferredName: optionalText(80),
  dateOfBirth: optionalDate,
  personalEmail: z.union([z.literal(""), z.string().email("That email address is not valid.")]).optional(),
  personalPhone: optionalText(40),
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(80),
  province: optionalProvince,
  postalCode: optionalText(12),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(40),
  emergencyContactRelation: optionalText(60),
  sin: optionalText(20),

  jobTitle: z.string().trim().min(1, "Job title is required.").max(120),
  departmentId: optionalText(40),
  managerId: optionalText(40),
  provinceOfEmployment: requiredProvince,
  employeeType: z.enum(EMPLOYEE_TYPES, { message: "Choose an employee type." }),
  hireDate: z.string().trim().min(1, "Hire date is required."),
  compensationType: z.enum(COMPENSATION_TYPES, { message: "Choose a compensation type." }),
  payRate: z.coerce.number().min(0, "Pay rate cannot be negative.").max(100_000_000),
  payFrequency: z.enum(PAY_FREQUENCIES, { message: "Choose a pay frequency." }),
  standardHoursPerWeek: z.union([z.literal(""), z.coerce.number().min(0).max(168)]).optional(),
  notes: optionalText(2000),
});

function sinFields(rawSin: string | null | undefined): { error: string | null; sinLast3: string | null; sinHash: string | null } {
  if (!rawSin) return { error: null, sinLast3: null, sinHash: null };
  const digits = normalizeSin(rawSin);
  if (!isValidSin(digits)) return { error: "That SIN does not look valid — check the digits and try again.", sinLast3: null, sinHash: null };
  return { error: null, sinLast3: sinLastThree(digits), sinHash: createHash("sha256").update(digits).digest("hex") };
}

async function assertDepartmentAndManager(companyId: string, departmentId: string | null | undefined, managerId: string | null | undefined, selfId?: string) {
  if (departmentId) {
    const dept = await departments.get(companyId, departmentId);
    if (!dept) return "That department does not exist in this company.";
  }
  if (managerId) {
    if (managerId === selfId) return "An employee cannot be their own manager.";
    const manager = await employees.get(companyId, managerId);
    if (!manager) return "That manager does not exist in this company.";
  }
  return null;
}

export async function createEmployeeAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the employee details and try again." };
  const input = parsed.data;

  const relationError = await assertDepartmentAndManager(company.id, input.departmentId, input.managerId);
  if (relationError) return { error: relationError };

  const sin = sinFields(input.sin);
  if (sin.error) return { error: sin.error };

  const hireDate = new Date(`${input.hireDate}T00:00:00.000Z`);
  if (Number.isNaN(hireDate.getTime())) return { error: "Hire date is not a valid date." };

  try {
    const employee = await runTransaction(async (tx) => {
      const employeeNumber = await bumpSequenceTx(tx, company.id, "employee");
      return employees.createTx(tx, {
          companyId: company.id,
          employeeNumber,
          legalFirstName: input.legalFirstName,
          legalLastName: input.legalLastName,
          preferredName: input.preferredName ?? null,
          dateOfBirth: input.dateOfBirth ?? null,
          personalEmail: input.personalEmail || null,
          personalPhone: input.personalPhone ?? null,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          province: input.province ?? null,
          postalCode: input.postalCode ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: input.emergencyContactPhone ?? null,
          emergencyContactRelation: input.emergencyContactRelation ?? null,
          sinLast3: sin.sinLast3,
          sinHash: sin.sinHash,
          jobTitle: input.jobTitle,
          departmentId: input.departmentId ?? null,
          managerId: input.managerId ?? null,
          provinceOfEmployment: input.provinceOfEmployment,
          employeeType: input.employeeType,
          hireDate,
          compensationType: input.compensationType,
          payRateCents: Math.round(input.payRate * 100),
          payFrequency: input.payFrequency,
          standardHoursPerWeek: input.standardHoursPerWeek === "" || input.standardHoursPerWeek === undefined ? null : input.standardHoursPerWeek,
          notes: input.notes ?? null,
          createdById: user.id,
      } as never);
    });

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "CREATE",
      entityType: "Employee",
      entityId: employee.id,
      summary: `Added employee ${employee.legalFirstName} ${employee.legalLastName} (${employee.employeeNumber})`,
    });

    revalidatePath("/hr/employees");
    return { ok: true as const, employeeId: employee.id };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function updateEmployeeAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing employee id." };

  const existing = await employees.get(company.id, id);
  if (!existing) return { error: "That employee no longer exists." };

  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the employee details and try again." };
  const input = parsed.data;

  const relationError = await assertDepartmentAndManager(company.id, input.departmentId, input.managerId, id);
  if (relationError) return { error: relationError };

  // Blank means "leave the stored SIN alone" — there is no reversible value to
  // diff against, so an empty field can never mean "clear it".
  const sin = input.sin ? sinFields(input.sin) : { error: null, sinLast3: existing.sinLast3, sinHash: existing.sinHash };
  if (sin.error) return { error: sin.error };

  const hireDate = new Date(`${input.hireDate}T00:00:00.000Z`);
  if (Number.isNaN(hireDate.getTime())) return { error: "Hire date is not a valid date." };

  const updated = await employees.update(company.id, id, {
      legalFirstName: input.legalFirstName,
      legalLastName: input.legalLastName,
      preferredName: input.preferredName ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      personalEmail: input.personalEmail || null,
      personalPhone: input.personalPhone ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      province: input.province ?? null,
      postalCode: input.postalCode ?? null,
      emergencyContactName: input.emergencyContactName ?? null,
      emergencyContactPhone: input.emergencyContactPhone ?? null,
      emergencyContactRelation: input.emergencyContactRelation ?? null,
      sinLast3: sin.sinLast3,
      sinHash: sin.sinHash,
      jobTitle: input.jobTitle,
      departmentId: input.departmentId ?? null,
      managerId: input.managerId ?? null,
      provinceOfEmployment: input.provinceOfEmployment,
      employeeType: input.employeeType,
      hireDate,
      compensationType: input.compensationType,
      payRateCents: Math.round(input.payRate * 100),
      payFrequency: input.payFrequency,
      standardHoursPerWeek: input.standardHoursPerWeek === "" || input.standardHoursPerWeek === undefined ? null : input.standardHoursPerWeek,
      notes: input.notes ?? null,
  } as never);

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Employee",
    entityId: updated.id,
    summary: `Updated employee ${updated.legalFirstName} ${updated.legalLastName} (${updated.employeeNumber})`,
  });

  revalidatePath("/hr/employees");
  revalidatePath(`/hr/employees/${id}`);
  return { ok: true as const, employeeId: updated.id };
}

const terminationSchema = z.object({
  id: z.string().min(1),
  terminationDate: z.string().trim().min(1, "Termination date is required."),
  terminationReason: z.enum(TERMINATION_REASON_CATEGORIES, { message: "Choose a reason." }),
  terminationNote: optionalText(1000),
});

export async function terminateEmployeeAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const parsed = terminationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the termination details and try again." };
  const input = parsed.data;

  const existing = await employees.get(company.id, input.id);
  if (!existing) return { error: "That employee no longer exists." };
  if (existing.employmentStatus === "TERMINATED") return { error: `${existing.legalFirstName} ${existing.legalLastName} is already terminated.` };

  const terminationDate = new Date(`${input.terminationDate}T00:00:00.000Z`);
  if (Number.isNaN(terminationDate.getTime())) return { error: "Termination date is not a valid date." };
  if (terminationDate < existing.hireDate) return { error: "The termination date cannot be before the hire date." };

  // Anyone who reported to this person loses that reporting line rather than
  // pointing at a terminated employee — the org chart only ever reflects
  // who is actually managing whom today.
  await employees.update(company.id, input.id, {
    employmentStatus: "TERMINATED",
    terminationDate,
    terminationReason: input.terminationReason,
    terminationNote: input.terminationNote ?? null,
  });
  const reports = await employees.list(company.id, { where: [["managerId", "==", input.id]] });
  for (const r of reports) await employees.update(company.id, r.id, { managerId: null });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Employee",
    entityId: input.id,
    summary: `Terminated employee ${existing.legalFirstName} ${existing.legalLastName} (${existing.employeeNumber})`,
    metadata: { terminationReason: input.terminationReason },
  });

  revalidatePath("/hr/employees");
  revalidatePath(`/hr/employees/${input.id}`);
  return { ok: true as const };
}

export async function reactivateEmployeeAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing employee id." };

  const existing = await employees.get(company.id, id);
  if (!existing) return { error: "That employee no longer exists." };
  if (existing.employmentStatus !== "TERMINATED") return { error: "This employee is not terminated." };

  await employees.update(company.id, id, {
    employmentStatus: "ACTIVE",
    terminationDate: null,
    terminationReason: null,
    terminationNote: null,
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Employee",
    entityId: id,
    summary: `Reactivated employee ${existing.legalFirstName} ${existing.legalLastName} (${existing.employeeNumber})`,
  });

  revalidatePath("/hr/employees");
  revalidatePath(`/hr/employees/${id}`);
  return { ok: true as const };
}

export async function setOnLeaveAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const id = String(formData.get("id") ?? "");
  const onLeave = String(formData.get("onLeave") ?? "") === "true";
  if (!id) return { error: "Missing employee id." };

  const existing = await employees.get(company.id, id);
  if (!existing) return { error: "That employee no longer exists." };
  if (existing.employmentStatus === "TERMINATED") return { error: "A terminated employee cannot be put on leave." };

  await employees.update(company.id, id, { employmentStatus: onLeave ? "ON_LEAVE" : "ACTIVE" });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Employee",
    entityId: id,
    summary: `${existing.legalFirstName} ${existing.legalLastName} marked ${onLeave ? "on leave" : "active"}`,
  });

  revalidatePath("/hr/employees");
  revalidatePath(`/hr/employees/${id}`);
  return { ok: true as const };
}
