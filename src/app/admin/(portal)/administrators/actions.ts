"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  promoteToAdministrator,
  removeAdministrator,
  suspendAdministrator,
  verifyStepUp,
} from "@/server/admin/administrators";
import { normalizeEmail } from "@/server/admin/clients";
import { optionalStr, runAdminAction, str } from "@/server/admin/run-action";

/**
 * Changing who can reach this console.
 *
 * Every action here begins with `verifyStepUp`. A valid session is not enough:
 * the operator must prove themselves again in this moment, with their
 * authenticator code if they have one enrolled, or their password if they do
 * not. That is what turns "someone walked past an unlocked laptop" from a
 * catastrophe into an inconvenience.
 *
 * The invariants that cannot be argued with — one active administrator always
 * remains, and nobody removes their own last access — are enforced in the
 * service layer, inside the transaction, not here.
 */

function refreshAdminViews(userId?: string) {
  revalidatePath("/admin/administrators");
  revalidatePath("/admin/users");
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

export async function promoteAdministratorAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await verifyStepUp(actor, {
      password: optionalStr(data, "confirmPassword") ?? null,
      totpCode: optionalStr(data, "totpCode") ?? null,
    });

    // Addressed by email so the operator types something they can verify by
    // reading, rather than an opaque id copied from a URL.
    const email = normalizeEmail(str(data, "email"));
    const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true } });
    if (!user) return { error: `No account exists for ${email}. Create the user first.` };

    await promoteToAdministrator(actor, { userId: user.id, reason: str(data, "reason") });
    refreshAdminViews(user.id);
    return { ok: true, message: `${email} can now sign in to the platform console.` };
  });
}

export async function promoteExistingUserAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await verifyStepUp(actor, {
      password: optionalStr(data, "confirmPassword") ?? null,
      totpCode: optionalStr(data, "totpCode") ?? null,
    });

    const userId = str(data, "userId");
    await promoteToAdministrator(actor, { userId, reason: str(data, "reason") });
    refreshAdminViews(userId);
    return { ok: true, message: "Platform administrator access granted." };
  });
}

export async function suspendAdministratorAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await verifyStepUp(actor, {
      password: optionalStr(data, "confirmPassword") ?? null,
      totpCode: optionalStr(data, "totpCode") ?? null,
    });

    const userId = str(data, "userId");
    await suspendAdministrator(actor, { userId, reason: str(data, "reason") });
    refreshAdminViews(userId);
    return { ok: true, message: "Their console access is suspended and their admin sessions are closed." };
  });
}

export async function removeAdministratorAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    await verifyStepUp(actor, {
      password: optionalStr(data, "confirmPassword") ?? null,
      totpCode: optionalStr(data, "totpCode") ?? null,
    });

    const userId = str(data, "userId");
    await removeAdministrator(actor, { userId, reason: str(data, "reason") });
    refreshAdminViews(userId);
    return { ok: true, message: "Platform administrator access removed." };
  });
}
