"use server";

import { revalidatePath } from "next/cache";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { cancelSeatRequest, requestExtraUsers, SeatRequestError } from "@/server/seats/requests";

/** Company side of "additional users": only records the ask. A platform administrator decides. */
export async function requestExtraUsersAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);
  const extraUsers = Number(formData.get("extraUsers"));
  const note = typeof formData.get("note") === "string" ? (formData.get("note") as string) : null;
  try {
    const request = await requestExtraUsers({ companyId: company.id, userId: user.id, extraUsers, note });
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "CREATE",
      entityType: "UserSeatRequest",
      entityId: request.id,
      summary: `Requested ${request.extraUsers} additional user${request.extraUsers === 1 ? "" : "s"} ($${(request.totalCents / 100).toFixed(2)} per month)`,
    });
    revalidatePath("/company/users");
    revalidatePath("/admin/user-requests");
    return { ok: true as const };
  } catch (error) {
    if (error instanceof SeatRequestError) return { error: error.message };
    throw error;
  }
}

export async function cancelSeatRequestAction(requestId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);
  try {
    await cancelSeatRequest(company.id, requestId);
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "UserSeatRequest",
      entityId: requestId,
      summary: "Cancelled an additional-users request",
    });
    revalidatePath("/company/users");
    revalidatePath("/admin/user-requests");
    return { ok: true as const };
  } catch (error) {
    if (error instanceof SeatRequestError) return { error: error.message };
    throw error;
  }
}
