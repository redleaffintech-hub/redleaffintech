"use server";

import { revalidatePath } from "next/cache";
import { runAdminAction, str } from "@/server/admin/run-action";
import { approveSeatRequest, rejectSeatRequest } from "@/server/seats/requests";

function refresh(companyId?: string) {
  revalidatePath("/admin/user-requests");
  revalidatePath("/admin");
  revalidatePath("/admin/subscriptions");
  if (companyId) {
    revalidatePath(`/admin/clients/${companyId}`);
    revalidatePath("/company/users");
  }
}

export async function approveSeatRequestAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const { request, after } = await approveSeatRequest(actor, str(formData, "id"));
    refresh(request.companyId);
    return { ok: true, message: `Approved. ${request.company.name} can now have ${after} users.` };
  });
}

export async function rejectSeatRequestAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const request = await rejectSeatRequest(actor, str(formData, "id"), str(formData, "reason"));
    refresh(request.companyId);
    return { ok: true, message: "Rejected. The company has been notified." };
  });
}
