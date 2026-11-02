"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { runAdminAction, str } from "@/server/admin/run-action";

export async function markEnquiryHandledAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    await db.contactEnquiry.update({
      where: { id: str(formData, "id") },
      data: { status: "HANDLED", handledAt: new Date(), handledBy: actor.email },
    });
    revalidatePath("/admin/enquiries");
    return { ok: true, message: "Marked as handled." };
  });
}
