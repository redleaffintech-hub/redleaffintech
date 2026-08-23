"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { checkPassword } from "@/lib/password-policy";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { markMfaVerified, revokeAllSessions } from "@/server/admin/session";
import { AUDIT_ACTIONS, recordPlatformAudit } from "@/server/admin/audit";
import { decryptSecret, encryptSecret } from "@/server/admin/crypto";
import { formatSecretForDisplay, generateTotpSecret, otpauthUri, verifyTotp } from "@/server/admin/totp";
import { runAdminAction, str } from "@/server/admin/run-action";

/**
 * The administrator's own account.
 *
 * MFA enrolment is two steps, and the intermediate state is deliberate: the
 * secret is generated and stored *encrypted* with `mfaEnabled` still false, so
 * an enrolment abandoned halfway leaves an account that still works. Only a
 * correct code from the authenticator flips the flag — which proves the secret
 * actually reached the app the operator will be locked out without.
 */

/** Step one: mint a secret and hand back what the authenticator app needs. */
export async function beginMfaEnrolmentAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const existing = await db.user.findUnique({
      where: { id: actor.id },
      select: { mfaEnabled: true },
    });
    if (existing?.mfaEnabled) {
      return { error: "Two-factor authentication is already enabled on your account." };
    }

    const secret = generateTotpSecret();
    await db.user.update({
      where: { id: actor.id },
      data: { mfaSecret: encryptSecret(secret), mfaEnabled: false },
    });

    revalidatePath("/admin/settings");

    // The secret is returned exactly once, to the person enrolling. It is stored
    // only as ciphertext and is never rendered again after confirmation.
    return {
      ok: true,
      message: `${formatSecretForDisplay(secret)}||${otpauthUri(secret, actor.email)}`,
    };
  });
}

/** Step two: prove the authenticator is working before switching it on. */
export async function confirmMfaEnrolmentAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const user = await db.user.findUnique({
      where: { id: actor.id },
      select: { mfaSecret: true, mfaEnabled: true },
    });
    if (!user?.mfaSecret) return { error: "Start the enrolment again — there is no pending secret." };
    if (user.mfaEnabled) return { error: "Two-factor authentication is already enabled." };

    const secret = decryptSecret(user.mfaSecret);
    if (!secret) return { error: "That enrolment could not be read. Start again." };

    if (!verifyTotp(secret, str(data, "code"))) {
      return { error: "That code is not valid. Check the time on your phone and try the next code." };
    }

    await db.user.update({
      where: { id: actor.id },
      data: { mfaEnabled: true, mfaEnrolledAt: new Date() },
    });
    await markMfaVerified(actor.sessionToken);

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.ADMIN_MFA_ENROLLED,
      entityType: "User",
      entityId: actor.id,
      summary: `${actor.email} enrolled two-factor authentication`,
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/administrators");
    return { ok: true, message: "Two-factor authentication is on. It will be required at your next sign-in." };
  });
}

export async function disableMfaAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const user = await db.user.findUnique({
      where: { id: actor.id },
      select: { passwordHash: true, mfaEnabled: true },
    });
    if (!user?.mfaEnabled) return { error: "Two-factor authentication is not enabled." };

    // The password, not a code: somebody who has lost their authenticator still
    // needs a way out, and they have already proved the password to be here.
    if (!(await verifyPassword(str(data, "password"), user.passwordHash))) {
      return { error: "That password is not correct." };
    }

    await db.user.update({
      where: { id: actor.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaEnrolledAt: null },
    });

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.ADMIN_MFA_DISABLED,
      entityType: "User",
      entityId: actor.id,
      summary: `${actor.email} turned off two-factor authentication`,
      reason: str(data, "reason") || null,
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/administrators");
    return { ok: true, message: "Two-factor authentication is off. Enrol again as soon as you can." };
  });
}

export async function changeOwnPasswordAction(formData: FormData) {
  return runAdminAction(formData, async (actor, data) => {
    const current = str(data, "currentPassword");
    const next = str(data, "newPassword");
    const confirm = str(data, "confirmPassword");

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
      return { error: "Choose a password you are not already using." };
    }

    const verdict = checkPassword(next, { email: user.email, name: user.name });
    if (!verdict.ok) return { error: verdict.problems.join(" ") };

    await db.user.update({
      where: { id: actor.id },
      data: {
        passwordHash: await hashPassword(next),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    // Other sessions go; this one is left alive so the operator is not thrown
    // out of the page they are standing on.
    await db.session.updateMany({
      where: { userId: actor.id, revokedAt: null, token: { not: actor.sessionToken } },
      data: { revokedAt: new Date() },
    });

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: "User",
      entityId: actor.id,
      summary: `${actor.email} changed their own password`,
    });

    revalidatePath("/admin/settings");
    return { ok: true, message: "Password changed. Every other session has been signed out." };
  });
}

export async function signOutEverywhereAction(formData: FormData) {
  return runAdminAction(formData, async (actor) => {
    const count = await revokeAllSessions(actor.id);

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.USER_SESSIONS_REVOKED,
      entityType: "User",
      entityId: actor.id,
      summary: `${actor.email} signed out of all sessions`,
    });

    revalidatePath("/admin/settings");
    return {
      ok: true,
      message: `${count} session${count === 1 ? "" : "s"} ended. You will need to sign in again.`,
    };
  });
}
