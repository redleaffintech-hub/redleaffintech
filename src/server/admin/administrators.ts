/**
 * Platform-administrator management — the screen that can lock Red Leaf out of
 * its own console. Every mutation: step-up auth, "one active admin always
 * remains" (checked atomically), and nobody removes their own last access.
 */

import "server-only";
import { verifyPassword } from "@/server/auth/password";
import { getUser } from "@/server/db/users";
import { runTransaction, top } from "@/server/db/firestore";
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

const tsToDate = (t: FirebaseFirestore.Timestamp | null | undefined) => t?.toDate?.() ?? null;

export async function listAdministrators() {
  const snap = await top("users").where("isPlatformAdmin", "==", true).get();
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        name: x.name as string,
        email: x.email as string,
        mfaEnabled: (x.mfaEnabled as boolean) ?? false,
        mfaEnrolledAt: tsToDate(x.mfaEnrolledAt),
        platformAdminSince: tsToDate(x.platformAdminSince),
        platformAdminSuspendedAt: tsToDate(x.platformAdminSuspendedAt),
        lastLoginAt: tsToDate(x.lastLoginAt),
        mustChangePassword: (x.mustChangePassword as boolean) ?? false,
        createdAt: tsToDate(x.createdAt) ?? new Date(0),
      };
    })
    .sort(
      (a, b) =>
        Number(Boolean(a.platformAdminSuspendedAt)) - Number(Boolean(b.platformAdminSuspendedAt)) ||
        (a.platformAdminSince?.getTime() ?? 0) - (b.platformAdminSince?.getTime() ?? 0),
    );
}

export async function countActiveAdministrators(): Promise<number> {
  const snap = await top("users")
    .where("isPlatformAdmin", "==", true)
    .where("platformAdminSuspendedAt", "==", null)
    .get();
  return snap.size;
}

export async function verifyStepUp(
  actor: AdminActor,
  input: { password?: string | null; totpCode?: string | null },
): Promise<void> {
  const user = await getUser(actor.id);
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

export async function promoteToAdministrator(
  actor: AdminActor,
  input: { userId: string; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new AdministratorError("Record why this person needs platform access.");

  const user = await getUser(input.userId);
  if (!user) throw new AdministratorError("That user no longer exists.");
  if (user.isPlatformAdmin && !user.platformAdminSuspendedAt) {
    throw new AdministratorError(`${user.email} is already a platform administrator.`);
  }

  await top("users").doc(user.id).update({
    isPlatformAdmin: true,
    platformAdminSince: new Date(),
    platformAdminSuspendedAt: null,
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

/** Read the "active admins other than `exceptId`" query in a tx, guard, then update. */
async function withLastAdminGuard(
  exceptId: string,
  update: Record<string, unknown>,
): Promise<void> {
  await runTransaction(async (tx) => {
    const snap = await tx.get(
      top("users")
        .where("isPlatformAdmin", "==", true)
        .where("platformAdminSuspendedAt", "==", null),
    );
    const remaining = snap.docs.filter((d) => d.id !== exceptId).length;
    if (remaining < 1) {
      throw new AdministratorError(
        "This is the last active platform administrator. Appoint another one first.",
      );
    }
    tx.update(top("users").doc(exceptId), update);
  });
}

export async function suspendAdministrator(
  actor: AdminActor,
  input: { userId: string; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new AdministratorError("Record why this administrator is being suspended.");
  if (input.userId === actor.id) {
    throw new AdministratorError(
      "Ask another administrator to suspend your access — you cannot lock yourself out.",
    );
  }

  const user = await getUser(input.userId);
  if (!user || !user.isPlatformAdmin) {
    throw new AdministratorError("That user is not a platform administrator.");
  }
  if (user.platformAdminSuspendedAt) {
    throw new AdministratorError("That administrator is already suspended.");
  }

  await withLastAdminGuard(user.id, { platformAdminSuspendedAt: new Date() });
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
    throw new AdministratorError(
      "You cannot remove your own platform access. Ask another administrator.",
    );
  }

  const user = await getUser(input.userId);
  if (!user || !user.isPlatformAdmin) {
    throw new AdministratorError("That user is not a platform administrator.");
  }

  await withLastAdminGuard(user.id, {
    isPlatformAdmin: false,
    platformAdminSince: null,
    platformAdminSuspendedAt: null,
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
