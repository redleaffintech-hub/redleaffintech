"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";

const nameSchema = z.object({ name: z.string().trim().min(1, "A department needs a name.").max(80) });

export async function createDepartmentAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const parsed = nameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the department name." };

  const clash = await db.department.findFirst({
    where: { companyId: company.id, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (clash) return { error: `"${clash.name}" already exists.` };

  const department = await db.department.create({ data: { companyId: company.id, name: parsed.data.name } });

  await recordAudit({
    companyId: company.id, userId: user.id, action: "CREATE", entityType: "Department",
    entityId: department.id, summary: `Added department "${department.name}"`,
  });

  revalidatePath("/hr/departments");
  return { ok: true as const };
}

const renameSchema = nameSchema.extend({ id: z.string().min(1) });

export async function renameDepartmentAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const parsed = renameSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the department name." };

  const existing = await db.department.findFirst({ where: { id: parsed.data.id, companyId: company.id } });
  if (!existing) return { error: "That department no longer exists." };

  const clash = await db.department.findFirst({
    where: { companyId: company.id, name: { equals: parsed.data.name, mode: "insensitive" }, id: { not: existing.id } },
  });
  if (clash) return { error: `"${clash.name}" already exists.` };

  await db.department.update({ where: { id: existing.id }, data: { name: parsed.data.name } });

  await recordAudit({
    companyId: company.id, userId: user.id, action: "UPDATE", entityType: "Department",
    entityId: existing.id, summary: `Renamed department "${existing.name}" to "${parsed.data.name}"`,
  });

  revalidatePath("/hr/departments");
  return { ok: true as const };
}

export async function deleteDepartmentAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing department id." };

  const existing = await db.department.findFirst({ where: { id, companyId: company.id } });
  if (!existing) return { error: "That department no longer exists." };

  const employeeCount = await db.employee.count({ where: { departmentId: id } });
  if (employeeCount > 0) {
    return { error: `"${existing.name}" has ${employeeCount} employee${employeeCount === 1 ? "" : "s"} assigned to it. Move them first.` };
  }

  await db.department.delete({ where: { id } });

  await recordAudit({
    companyId: company.id, userId: user.id, action: "DELETE", entityType: "Department",
    entityId: id, summary: `Deleted department "${existing.name}"`,
  });

  revalidatePath("/hr/departments");
  return { ok: true as const };
}
