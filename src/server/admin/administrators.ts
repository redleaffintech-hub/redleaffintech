/**
 * Platform-administrator management.
 *
 * This is the most dangerous screen in the product: it is the one that can lock
 * Red Leaf out of its own console, or quietly hand the console to someone else.
 * Three protections apply to every mutation here and nowhere else:
 *
 *   1. **Step-up authentication.** Holding a valid session is not enough — the
 *      operator must prove themselves again, right now, with their MFA code if
 *      they have one enrolled or their password if they do not.
 *   2. **At least one active administrator always remains.** Enforced inside the
 *      same transaction as the change, so two operators demoting each other
 *      concurrently cannot both succeed.
 *   3. **Nobody removes their own last access.** An operator who wants out asks
 *      a colleague, which guarantees a second person knows the console changed
 *      hands.
 */

import "server-only";
import { db } from "@/lib/db";
import { verifyPassword } from "@/server/auth/password";
import { AUDIT_ACTIONS, recordPlatformAudit } from "./audit";
import { decryptSecret } from "./crypto";
import { verifyTotp } from "./totp";
import { markMfaVerified, revokeAdminSessions } from "./session";
import type { AdminActor } from "./guard";

export class AdministratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdministratorError";
  }
}

export async function listAdministrators() {
  return db.user.findMany({
    where: { isPlatformAdmin: true },
    orderBy: [{ platformAdminSuspendedAt: "asc" }, { platformAdminSince: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      mfaEnabled: true,
      mfaEnrolledAt: true,
      platformAdminSince: true,
      platformAdminSuspendedAt: true,
      lastLoginAt: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
}

export async function countActiveAdministrators(): Promise<number> {
  return db.user.count({ where: { isPlatformAdmin: true, platformAdminSuspendedAt: null } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step-up
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-authenticate the operator for a high-risk action.
 *
 * With MFA enrolled the code is the proof and the session's step-up clock is
 * reset, so a burst of related changes does not demand a fresh code for each
 * one. Without MFA the password is the proof, and it is checked every time —
 * there is nothing to remember.
 */
export async function verifyStepUp(
  actor: AdminActor,
  input: { password?: string | null; totpCode?: string | null },
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: actor.id },
    select: { passwordHash: true, mfaEnabled: true, mfaSecret: true },
  });
  if (!user) throw new AdministratorError("Your account is no longer available.");

  if (user.mfaEnabled) {
    if (actor.recentlyVerified) return;
    const code = input.totpCode?.trim();
    if (!code) throw new AdministratorError("Enter the six-digit code from your authenticator app.");
    const secret = decryptSecret(user.mfaSecret);
    if (!secret || !verifyTotp(secret, code)) {
      throw new AdministratorError("That code is not valid. Check your authenticator and try again.");
    }
    await markMfaVerified(actor.sessionToken);
    return;
  }

  const password = input.password;
  if (!password) throw new AdministratorError("Confirm your password to make this change.");
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AdministratorError("That password is not correct.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Granting and withdrawing
// ─────────────────────────────────────────────────────────────────────────────

export async function promoteToAdministrator(
  actor: AdminActor,
  input: { userId: string; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new AdministratorError("Record why this person needs platform access.");

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, name: true, isPlatformAdmin: true, platformAdminSuspendedAt: true },
  });
  if (!user) throw new AdministratorError("That user no longer exists.");
  if (user.isPlatformAdmin && !user.platformAdminSuspendedAt) {
    throw new AdministratorError(`${user.email} is already a platform administrator.`);
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      isPlatformAdmin: true,
      platformAdminSince: new Date(),
      platformAdminSuspendedAt: null,
    },
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: user.isPlatformAdmin ? AUDIT_ACTIONS.ADMIN_REINSTATED : AUDIT_ACTIONS.ADMIN_PROMOTED,
    entityType: "User",
    entityId: user.id,
    summary: `${user.email} ${user.isPlatformAdmin ? "reinstated as" : "granted"} platform administrator`,
    reason,
    before: { isPlatformAdmin: user.isPlatformAdmin, suspended: Boolean(user.platformAdminSuspendedAt) },
    after: { isPlatformAdmin: true, suspended: false },
  });
}

export async function suspendAdministrator(
  actor: AdminActor,
  input: { userId: string; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new AdministratorError("Record why this administrator is being suspended.");
  if (input.userId === actor.id) {
    throw new AdministratorError("Ask another administrator to suspend your access — you cannot lock yourself out.");
  }

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, isPlatformAdmin: true, platformAdminSuspendedAt: true },
  });
  if (!user || !user.isPlatformAdmin) throw new AdministratorError("That user is not a platform administrator.");
  if (user.platformAdminSuspendedAt) throw new AdministratorError("That administrator is already suspended.");

  await db.$transaction(async (tx) => {
    // Counting inside the transaction is what makes this safe against two
    // operators suspending the last two administrators at the same moment.
    const remaining = await tx.user.count({
      where: { isPlatformAdmin: true, platformAdminSuspendedAt: null, id: { not: user.id } },
    });
    if (remaining < 1) {
      throw new AdministratorError("This is the last active platform administrator. Appoint another one first.");
    }
    await tx.user.update({
      where: { id: user.id },
      data: { platformAdminSuspendedAt: new Date() },
    });
  });

  // Suspension that leaves a live console session open has not taken effect.
  await revokeAdminSessions(user.id);

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.ADMIN_SUSPENDED,
    entityType: "User",
    entityId: user.id,
    summary: `${user.email} suspended as platform administrator`,
    reason,
    before: { suspended: false },
    after: { suspended: true },
  });
}

export async function removeAdministrator(
  actor: AdminActor,
  input: { userId: string; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new AdministratorError("Record why platform access is being removed.");
  if (input.userId === actor.id) {
    throw new AdministratorError("You cannot remove your own platform access. Ask another administrator.");
  }

  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, email: true, isPlatformAdmin: true, platformAdminSuspendedAt: true },
  });
  if (!user || !user.isPlatformAdmin) throw new AdministratorError("That user is not a platform administrator.");

  await db.$transaction(async (tx) => {
    const remaining = await tx.user.count({
      where: { isPlatformAdmin: true, platformAdminSuspendedAt: null, id: { not: user.id } },
    });
    if (remaining < 1) {
      throw new AdministratorError("This is the last active platform administrator. Appoint another one first.");
    }
    await tx.user.update({
      where: { id: user.id },
      data: {
        isPlatformAdmin: false,
        platformAdminSince: null,
        platformAdminSuspendedAt: null,
        // MFA enrolment is left alone: it belongs to the person, not to the
        // privilege, and they may still use the accounting app.
      },
    });
  });

  await revokeAdminSessions(user.id);

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.ADMIN_DEMOTED,
    entityType: "User",
    entityId: user.id,
    summary: `${user.email} removed as platform administrator`,
    reason,
    before: { isPlatformAdmin: true },
    after: { isPlatformAdmin: false },
  });
}
