"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/server/auth/password";
import { createAdminSession, destroyAdminSession } from "@/server/admin/session";
import { checkLoginAllowed, equaliseTiming, recordAttempt } from "@/server/admin/rate-limit";
import { AUDIT_ACTIONS, recordPlatformAudit, requestMeta } from "@/server/admin/audit";
import { decryptSecret } from "@/server/admin/crypto";
import { verifyTotp } from "@/server/admin/totp";
import { getAdminActor } from "@/server/admin/guard";
import { assertCsrf, CsrfError } from "@/server/admin/csrf";

/**
 * Platform-administrator sign-in.
 *
 * The shape of this action is dictated by what it must *not* leak. Every failure
 * before the session is created returns the same sentence, whether the email is
 * unknown, the password is wrong, or the account is a perfectly valid customer
 * who simply is not a platform administrator. Anything more specific turns this
 * form into a tool for finding out who at Red Leaf has console access.
 *
 * The one exception is the MFA step, which is only ever reached *after* the
 * password has already been verified — by then the caller has proved they hold
 * the credential, so telling them a code is required reveals nothing new.
 */

const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  code: z.string().optional(),
});

export interface AdminLoginResult {
  error?: string;
  /** The password was right; a second factor is now needed. */
  mfaRequired?: boolean;
}

export async function adminLoginAction(formData: FormData): Promise<AdminLoginResult> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    // FormData.get() returns null for an absent field (the code box only
    // renders after a first submit); z.string().optional() accepts undefined
    // but not null, so an absent code otherwise poisons the whole parse.
    code: formData.get("code") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const email = parsed.data.email.trim().toLowerCase();
  const meta = await requestMeta();
  const attempt = { email, scope: "ADMIN" as const, ip: meta.ip, userAgent: meta.userAgent };

  // Deliberately vague, and identical for every kind of refusal.
  const refuse = { error: "Those credentials do not match a platform administrator account." };

  const verdict = await checkLoginAllowed(attempt);
  if (!verdict.allowed) {
    await recordAttempt({ ...attempt, outcome: "LOCKED_OUT" });
    const minutes = Math.ceil(verdict.retryAfterSeconds / 60);
    return {
      error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      isPlatformAdmin: true,
      platformAdminSuspendedAt: true,
      mfaEnabled: true,
      mfaSecret: true,
      mustChangePassword: true,
    },
  });

  if (!user) {
    // Burn the same time a real bcrypt comparison would, or the response time
    // itself answers "does this email exist".
    await equaliseTiming();
    await recordAttempt({ ...attempt, outcome: "UNKNOWN_USER" });
    return refuse;
  }

  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await recordAttempt({ ...attempt, outcome: "BAD_PASSWORD" });
    await recordPlatformAudit({
      actorUserId: null,
      actorEmail: email,
      action: AUDIT_ACTIONS.ADMIN_LOGIN_FAILURE,
      entityType: "User",
      entityId: user.id,
      summary: `Failed admin sign-in for ${email} (incorrect password)`,
    });
    return refuse;
  }

  if (!user.isPlatformAdmin || user.platformAdminSuspendedAt) {
    await recordAttempt({ ...attempt, outcome: "NOT_ADMIN" });
    await recordPlatformAudit({
      actorUserId: null,
      actorEmail: email,
      action: AUDIT_ACTIONS.ADMIN_LOGIN_FAILURE,
      entityType: "User",
      entityId: user.id,
      summary: user.platformAdminSuspendedAt
        ? `Suspended administrator ${email} attempted to sign in`
        : `Non-administrator ${email} attempted to reach the platform console`,
    });
    return refuse;
  }

  let mfaVerified = false;
  if (user.mfaEnabled) {
    const code = parsed.data.code?.trim();
    if (!code) return { mfaRequired: true };

    const secret = decryptSecret(user.mfaSecret);
    if (!secret || !verifyTotp(secret, code)) {
      await recordAttempt({ ...attempt, outcome: "MFA_FAILED" });
      await recordPlatformAudit({
        actorUserId: null,
        actorEmail: email,
        action: AUDIT_ACTIONS.ADMIN_LOGIN_FAILURE,
        entityType: "User",
        entityId: user.id,
        summary: `Failed admin sign-in for ${email} (incorrect authenticator code)`,
      });
      return { mfaRequired: true, error: "That code is not valid. Check your authenticator and try again." };
    }
    mfaVerified = true;
  }

  await createAdminSession(user.id, {
    userAgent: meta.userAgent,
    ip: meta.ip,
    mfaVerified,
  });

  await recordAttempt({ ...attempt, outcome: "OK" });
  await recordPlatformAudit({
    actorUserId: user.id,
    actorEmail: user.email,
    action: AUDIT_ACTIONS.ADMIN_LOGIN_SUCCESS,
    entityType: "User",
    entityId: user.id,
    summary: `${user.email} signed in to the platform console${mfaVerified ? " with MFA" : ""}`,
  });

  redirect(user.mustChangePassword ? "/admin/change-password" : "/admin");
}

export async function adminSignOutAction(formData: FormData) {
  const actor = await getAdminActor();

  // Signing someone out is not destructive, but it is still a state change made
  // on their behalf, and a cross-site form post that logs an operator out mid-task
  // is a cheap nuisance worth closing.
  try {
    await assertCsrf(formData);
  } catch (error) {
    if (!(error instanceof CsrfError)) throw error;
    return { error: "This page has expired. Reload and try again." };
  }

  await destroyAdminSession();

  if (actor) {
    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.ADMIN_LOGOUT,
      entityType: "User",
      entityId: actor.id,
      summary: `${actor.email} signed out of the platform console`,
    });
  }

  redirect("/admin/login");
}
