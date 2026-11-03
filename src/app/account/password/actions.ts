"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { checkPassword } from "@/lib/password-policy";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { readSession } from "@/server/auth/session";
import { requireUser } from "@/server/auth/context";

/**
 * Change the signed-in user's own password. The current password (the temporary one, on a
 * first sign-in) is required, and every other session is signed out so a temporary password
 * that was shared stops working the moment the real owner replaces it.
 */
export async function changePasswordAction(formData: FormData) {
  const sessionUser = await requireUser();

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!current) return { error: "Enter your current password." };
  if (next !== confirm) return { error: "The two new passwords do not match." };

  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { passwordHash: true, email: true, name: true, activeCompanyId: true },
  });
  if (!user) return { error: "Your account is no longer available." };

  if (!(await verifyPassword(current, user.passwordHash))) return { error: "That is not your current password." };
  if (await verifyPassword(next, user.passwordHash)) return { error: "Choose a password you have not just been using." };

  const verdict = checkPassword(next, { email: user.email, name: user.name });
  if (!verdict.ok) return { error: verdict.problems.join(" ") };

  const session = await readSession();
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: sessionUser.id },
      data: { passwordHash: await hashPassword(next), mustChangePassword: false, passwordChangedAt: new Date() },
    });
    await tx.session.updateMany({
      where: { userId: sessionUser.id, revokedAt: null, ...(session ? { token: { not: session.token } } : {}) },
      data: { revokedAt: new Date() },
    });
    await tx.userToken.updateMany({ where: { userId: sessionUser.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        userId: sessionUser.id,
        action: "UPDATE",
        entityType: "User",
        entityId: sessionUser.id,
        summary: `${user.email} changed their password`,
        companyId: user.activeCompanyId,
      },
    });
  });

  redirect("/dashboard");
}
