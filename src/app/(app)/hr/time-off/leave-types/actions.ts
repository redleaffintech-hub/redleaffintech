"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LEAVE_CATEGORIES } from "@/lib/hr-enums";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { leaveTypes } from "@/server/db/hr";

const createSchema = z.object({
  name: z.string().trim().min(1, "A leave type needs a name.").max(80),
  category: z.enum(LEAVE_CATEGORIES, { message: "Choose a category." }),
  isPaid: z.coerce.boolean(),
  trackBalance: z.coerce.boolean(),
});

export async function createLeaveTypeAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const raw = Object.fromEntries(formData);
  const parsed = createSchema.safeParse({ ...raw, isPaid: formData.get("isPaid") === "on", trackBalance: formData.get("trackBalance") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the leave type details." };

  const wanted = parsed.data.name.toLowerCase();
  const clash = (await leaveTypes.list(company.id)).find((t) => t.name.toLowerCase() === wanted);
  if (clash) return { error: `"${clash.name}" already exists.` };

  const leaveType = await leaveTypes.create({ companyId: company.id, isActive: true, ...parsed.data });

  await recordAudit({
    companyId: company.id, userId: user.id, action: "CREATE", entityType: "LeaveType",
    entityId: leaveType.id, summary: `Added leave type "${leaveType.name}"`,
  });

  revalidatePath("/hr/time-off/leave-types");
  return { ok: true as const };
}

const updateSchema = createSchema.extend({ id: z.string().min(1) }).omit({ trackBalance: true });

export async function updateLeaveTypeAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const raw = Object.fromEntries(formData);
  const parsed = updateSchema.safeParse({ ...raw, isPaid: formData.get("isPaid") === "on" });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the leave type details." };

  const existing = await leaveTypes.get(company.id, parsed.data.id);
  if (!existing) return { error: "That leave type no longer exists." };

  const wanted = parsed.data.name.toLowerCase();
  const clash = (await leaveTypes.list(company.id)).find(
    (t) => t.name.toLowerCase() === wanted && t.id !== existing.id,
  );
  if (clash) return { error: `"${clash.name}" already exists.` };

  await leaveTypes.update(company.id, existing.id, {
    name: parsed.data.name,
    category: parsed.data.category,
    isPaid: parsed.data.isPaid,
  });

  await recordAudit({
    companyId: company.id, userId: user.id, action: "UPDATE", entityType: "LeaveType",
    entityId: existing.id, summary: `Updated leave type "${parsed.data.name}"`,
  });

  revalidatePath("/hr/time-off/leave-types");
  return { ok: true as const };
}

export async function setLeaveTypeActiveAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.HR);
  const id = String(formData.get("id") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";
  if (!id) return { error: "Missing leave type id." };

  const existing = await leaveTypes.get(company.id, id);
  if (!existing) return { error: "That leave type no longer exists." };

  await leaveTypes.update(company.id, id, { isActive });

  await recordAudit({
    companyId: company.id, userId: user.id, action: "UPDATE", entityType: "LeaveType",
    entityId: id, summary: `Leave type "${existing.name}" ${isActive ? "activated" : "deactivated"}`,
  });

  revalidatePath("/hr/time-off/leave-types");
  return { ok: true as const };
}
