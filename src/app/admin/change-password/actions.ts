"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { checkPassword } from "@/lib/password-policy";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { requirePasswordChangeActor } from "@/server/admin/guard";
import { assertCsrf, CsrfError } from "@/server/admin/csrf";
import { AUDIT_ACTIONS, recordPlatformAudit } from "@/server/admin/audit";
import { createAdminSession, destroyAdminSession, revokeAllSessions } from "@/server/admin/session";
import { requestMeta } from "@/server/admin/audit";

/**
 * Set a new password on an account that is required to change one.
 *
 * The current password is still required — a laptop left unlocked is exactly the
 * situation `mustChangePassword` exists to survive, and a form that lets whoever
 * is sitting there choose a new password without knowing the old one hands the
 * account over rather than protecting it.
 *
 * On success every other session is revoked and a fresh one issued, so a
 * temporary password that had been shared with somebody stops working the moment
 * the real owner replaces it.
 */
export async function changeOwnPasswordAction(formData: FormData) {
  const actor = await requirePasswordChangeActor();

  try {
    await assertCsrf(formData);
  } catch (error) {
    if (!(error instanceof CsrfError)) throw error;
    return { error: error.message };
  }

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!current) return { error: "Enter your current password." };
  if (next !== confirm) return { error: "The two new passwords do not match." };

  const user = await db.user.findUnique({
    where: { id: actor.id },
    select: { passwordHash: true, email: true, name: true },
  });
  if (!user) return { error: "Your account is no longer available." };

  if (!(await verifyPassword(current, user.passwordHash))) {
    return { error: "That is not your current password." };
  }
  if (await verifyPassword(next, user.passwordHash)) {
    return { error: "Choose a password you have not just been using." };
  }

  const verdict = checkPassword(next, { email: user.email, name: user.name });
  if (!verdict.ok) return { error: verdict.problems.join(" ") };

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: {
        passwordHash: await hashPassword(next),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    // Any outstanding invitation or reset link is spent by choosing a password.
    await tx.userToken.updateMany({
      where: { userId: actor.id, usedAt: null },
      data: { usedAt: new Date() },
    });
  });

  await revokeAllSessions(actor.id);
  await destroyAdminSession();

  const meta = await requestMeta();
  await createAdminSession(actor.id, {
    userAgent: meta.userAgent,
    ip: meta.ip,
    // The password was just proved; MFA, if enrolled, still has its own clock
    // and is not implied by this.
    mfaVerified: false,
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: "User",
    entityId: actor.id,
    summary: `${actor.email} set a new password`,
  });

  redirect("/admin");
}
