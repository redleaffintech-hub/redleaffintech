/**
 * User and membership administration.
 *
 * Two rules run through everything here.
 *
 * **The membership row is still the authorisation.** A platform administrator
 * can grant, change and withdraw access to a client company, but they do it by
 * writing `CompanyUser` — the same record `requireCompany()` reads. There is no
 * second, privileged path into a tenant, and being a platform administrator does
 * not by itself let anyone read a client's books.
 *
 * **A client must never be locked out of their own file.** Every operation that
 * could remove the last active PRIMARY user from a company is refused, because
 * the alternative is a company nobody can administer and a support ticket that
 * can only be resolved by hand in the database.
 */

import "server-only";
import { db, type Tx } from "@/lib/db";
import { COMPANY_ROLES, type CompanyRole } from "@/lib/enums";
import { hashPassword } from "@/server/auth/password";
import { revokeAllSessions } from "./session";
import { AUDIT_ACTIONS, recordPlatformAudit } from "./audit";
import { generateTemporaryPassword, generateToken, hashToken } from "./crypto";
import { normalizeEmail } from "./clients";
import type { AdminActor } from "./guard";

export class UserAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserAdminError";
  }
}

const RESET_TOKEN_HOURS = 24;
const INVITE_TOKEN_HOURS = 72;

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

export interface UserFilters {
  q?: string;
  companyId?: string;
  page?: number;
  perPage?: number;
  platformAdminsOnly?: boolean;
}

export async function listUsers(filters: UserFilters) {
  const perPage = Math.min(Math.max(filters.perPage ?? 25, 5), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const q = filters.q?.trim();

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }
  if (filters.companyId) where.companyUsers = { some: { companyId: filters.companyId } };
  if (filters.platformAdminsOnly) where.isPlatformAdmin = true;

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        name: true,
        email: true,
        isPlatformAdmin: true,
        platformAdminSuspendedAt: true,
        mfaEnabled: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        companyUsers: {
          select: {
            role: true,
            status: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  return { rows: users, total, page, perPage, pageCount: Math.max(1, Math.ceil(total / perPage)) };
}

export async function getUser(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      isPlatformAdmin: true,
      platformAdminSince: true,
      platformAdminSuspendedAt: true,
      mfaEnabled: true,
      mfaEnrolledAt: true,
      mustChangePassword: true,
      passwordChangedAt: true,
      lastLoginAt: true,
      activeCompanyId: true,
      createdAt: true,
      companyUsers: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          invitedAt: true,
          acceptedAt: true,
          company: {
            select: {
              id: true,
              name: true,
              subscription: { select: { status: true, plan: true, seats: true } },
            },
          },
        },
      },
      sessions: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: 10,
        // Never the token. A session list is for recognising a device, not for
        // reproducing one.
        select: { id: true, scope: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Guards shared by several operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Would this change leave the company with no active PRIMARY user?
 *
 * A company whose entire subscription is suspended or cancelled is exempt: that
 * client is intentionally switched off, and insisting it keep an administrator
 * would block the very cleanup that closing an account requires.
 */
async function assertNotLastPrimary(
  client: Tx | typeof db,
  membership: { id: string; companyId: string; role: string; status: string },
  action: string,
) {
  if (membership.role !== "PRIMARY" || membership.status !== "ACTIVE") return;

  const [others, subscription] = await Promise.all([
    client.companyUser.count({
      where: {
        companyId: membership.companyId,
        role: "PRIMARY",
        status: "ACTIVE",
        id: { not: membership.id },
      },
    }),
    client.subscription.findUnique({
      where: { companyId: membership.companyId },
      select: { status: true },
    }),
  ]);

  if (others > 0) return;
  if (subscription && ["SUSPENDED", "CANCELLED"].includes(subscription.status)) return;

  throw new UserAdminError(
    `This is the company's only active primary user. Assign another primary user before you ${action}.`,
  );
}

/** Seats in use, counting the invited — they are about to occupy one. */
async function seatUsage(client: Tx | typeof db, companyId: string) {
  const [used, subscription] = await Promise.all([
    client.companyUser.count({ where: { companyId, status: { in: ["ACTIVE", "INVITED"] } } }),
    client.subscription.findUnique({
      where: { companyId },
      select: { seats: true, seatsOverridden: true, plan: true },
    }),
  ]);
  return { used, allowed: subscription?.seats ?? null, subscription };
}

// ─────────────────────────────────────────────────────────────────────────────
// Creating users
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUserResult {
  userId: string;
  /** Shown once, never stored in readable form, never retrievable again. */
  temporaryPassword: string | null;
  /** The invitation link's secret half, if one was issued. Also shown once. */
  inviteToken: string | null;
  existed: boolean;
}

/**
 * Create a user, or hand back the existing one with the same email.
 *
 * Email is the login identifier and is normalised to lower case before anything
 * else happens, so `Dev@Example.ca` and `dev@example.ca` can never become two
 * accounts that both believe they own the same inbox.
 *
 * No password is ever chosen for someone by an administrator and left in place:
 * either an invitation token is issued (preferred — the user sets their own), or
 * a temporary password is generated, displayed exactly once, and paired with
 * `mustChangePassword` so it cannot survive the first sign-in.
 */
export async function createUser(
  actor: AdminActor,
  input: { name: string; email: string; method: "INVITE" | "TEMPORARY" },
): Promise<CreateUserResult> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!email.includes("@")) throw new UserAdminError("Enter a valid email address.");
  if (!name) throw new UserAdminError("Enter the person's name.");

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return { userId: existing.id, temporaryPassword: null, inviteToken: null, existed: true };
  }

  const useInvite = input.method === "INVITE";
  // Even the invitation path stores a password hash: the column is required, and
  // a random one nobody knows is safer than a placeholder somebody might guess.
  const temporaryPassword = useInvite ? null : generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword ?? generateToken());

  const inviteToken = useInvite ? generateToken() : null;

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, name, passwordHash, mustChangePassword: true },
      select: { id: true },
    });
    if (inviteToken) {
      await tx.userToken.create({
        data: {
          userId: created.id,
          purpose: "INVITE",
          tokenHash: hashToken(inviteToken),
          expiresAt: new Date(Date.now() + INVITE_TOKEN_HOURS * 3_600_000),
          createdById: actor.id,
        },
      });
    }
    return created;
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: "User",
    entityId: user.id,
    summary: `User ${email} created (${useInvite ? "invitation issued" : "temporary password issued"})`,
    after: { email, name, method: input.method },
  });

  return { userId: user.id, temporaryPassword, inviteToken, existed: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Memberships
// ─────────────────────────────────────────────────────────────────────────────

export async function grantMembership(
  actor: AdminActor,
  input: { userId: string; companyId: string; role: string; allowSeatOverage?: boolean },
) {
  if (!(COMPANY_ROLES as readonly string[]).includes(input.role)) {
    throw new UserAdminError("That is not a role this product has.");
  }

  const [user, company, existing] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true } }),
    db.company.findUnique({ where: { id: input.companyId }, select: { id: true, name: true } }),
    db.companyUser.findUnique({
      where: { companyId_userId: { companyId: input.companyId, userId: input.userId } },
      select: { id: true, status: true, role: true },
    }),
  ]);
  if (!user) throw new UserAdminError("That user no longer exists.");
  if (!company) throw new UserAdminError("That client no longer exists.");

  if (existing && existing.status === "ACTIVE") {
    throw new UserAdminError(`${user.email} already has access to ${company.name}.`);
  }

  const { used, allowed } = await seatUsage(db, input.companyId);
  if (allowed !== null && used >= allowed && !input.allowSeatOverage) {
    throw new UserAdminError(
      `${company.name} is using ${used} of ${allowed} seats. Raise the seat allowance on the subscription before adding another person.`,
    );
  }

  const membership = existing
    ? await db.companyUser.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", role: input.role, acceptedAt: new Date() },
      })
    : await db.companyUser.create({
        data: {
          companyId: input.companyId,
          userId: input.userId,
          role: input.role,
          status: "ACTIVE",
          invitedAt: new Date(),
          acceptedAt: new Date(),
        },
      });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.MEMBERSHIP_GRANTED,
    entityType: "CompanyUser",
    entityId: membership.id,
    summary: `${user.email} granted ${input.role} access to ${company.name}`,
    reason: input.allowSeatOverage ? "Seat limit overridden by platform administrator" : null,
    after: { companyId: input.companyId, userId: input.userId, role: input.role },
  });

  // The client's own audit log should show this too — from their point of view
  // somebody gained access to their books, and they are entitled to see it.
  await db.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: null,
      action: "CREATE",
      entityType: "CompanyUser",
      entityId: membership.id,
      summary: `${user.email} was granted ${input.role} access by Red Leaf support`,
    },
  });

  return membership;
}

export async function changeMembershipRole(
  actor: AdminActor,
  input: { membershipId: string; role: string },
) {
  if (!(COMPANY_ROLES as readonly string[]).includes(input.role)) {
    throw new UserAdminError("That is not a role this product has.");
  }

  const membership = await db.companyUser.findUnique({
    where: { id: input.membershipId },
    select: {
      id: true,
      role: true,
      status: true,
      companyId: true,
      user: { select: { email: true } },
      company: { select: { name: true } },
    },
  });
  if (!membership) throw new UserAdminError("That membership no longer exists.");
  if (membership.role === input.role) throw new UserAdminError("That is already their role.");

  if (membership.role === "PRIMARY") {
    await assertNotLastPrimary(db, membership, "change this role");
  }

  const updated = await db.companyUser.update({
    where: { id: membership.id },
    data: { role: input.role },
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.MEMBERSHIP_ROLE_CHANGED,
    entityType: "CompanyUser",
    entityId: membership.id,
    summary: `${membership.user.email} in ${membership.company.name}: ${membership.role} → ${input.role}`,
    before: { role: membership.role },
    after: { role: input.role },
  });

  await db.auditLog.create({
    data: {
      companyId: membership.companyId,
      action: "UPDATE",
      entityType: "CompanyUser",
      entityId: membership.id,
      summary: `${membership.user.email} changed from ${membership.role} to ${input.role} by Red Leaf support`,
    },
  });

  return updated;
}

export async function setMembershipStatus(
  actor: AdminActor,
  input: { membershipId: string; status: "ACTIVE" | "SUSPENDED"; reason?: string | null },
) {
  const membership = await db.companyUser.findUnique({
    where: { id: input.membershipId },
    select: {
      id: true,
      role: true,
      status: true,
      companyId: true,
      user: { select: { email: true } },
      company: { select: { name: true } },
    },
  });
  if (!membership) throw new UserAdminError("That membership no longer exists.");
  if (membership.status === input.status) throw new UserAdminError("That is already their status.");

  if (input.status === "SUSPENDED") {
    if (!input.reason?.trim()) throw new UserAdminError("Give a reason for suspending someone's access.");
    await assertNotLastPrimary(db, membership, "suspend this person");
  }

  const updated = await db.companyUser.update({
    where: { id: membership.id },
    data: { status: input.status },
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action:
      input.status === "SUSPENDED" ? AUDIT_ACTIONS.MEMBERSHIP_SUSPENDED : AUDIT_ACTIONS.MEMBERSHIP_REACTIVATED,
    entityType: "CompanyUser",
    entityId: membership.id,
    summary: `${membership.user.email} access to ${membership.company.name} ${
      input.status === "SUSPENDED" ? "suspended" : "reactivated"
    }`,
    reason: input.reason ?? null,
    before: { status: membership.status },
    after: { status: input.status },
  });

  return updated;
}

export async function removeMembership(
  actor: AdminActor,
  input: { membershipId: string; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new UserAdminError("Give a reason for removing someone's access.");

  const membership = await db.companyUser.findUnique({
    where: { id: input.membershipId },
    select: {
      id: true,
      role: true,
      status: true,
      companyId: true,
      userId: true,
      user: { select: { email: true } },
      company: { select: { name: true } },
    },
  });
  if (!membership) throw new UserAdminError("That membership no longer exists.");

  await assertNotLastPrimary(db, membership, "remove this person");

  await db.$transaction(async (tx) => {
    await tx.companyUser.delete({ where: { id: membership.id } });
    // Leaving `activeCompanyId` pointing at a company they can no longer reach
    // sends them to a dead route on next sign-in.
    await tx.user.updateMany({
      where: { id: membership.userId, activeCompanyId: membership.companyId },
      data: { activeCompanyId: null },
    });
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.MEMBERSHIP_REMOVED,
    entityType: "CompanyUser",
    entityId: membership.id,
    summary: `${membership.user.email} removed from ${membership.company.name}`,
    reason,
    before: { role: membership.role, status: membership.status },
  });

  await db.auditLog.create({
    data: {
      companyId: membership.companyId,
      action: "UPDATE",
      entityType: "CompanyUser",
      entityId: membership.id,
      summary: `${membership.user.email} was removed from the company by Red Leaf support`,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────────────────────

export interface PasswordResetResult {
  /** The secret half of the link. Displayed once; only its hash is stored. */
  token: string | null;
  temporaryPassword: string | null;
  expiresAt: Date;
}

/**
 * Start a password reset.
 *
 * Whichever method is used, the same three things happen: every outstanding
 * token for this user is spent, a new single-use one is issued, and every live
 * session is revoked. A reset that leaves the old session alive has not
 * recovered the account from whoever had it.
 *
 * An administrator can never *read* an existing password — there is nothing to
 * read, only a bcrypt hash — and this deliberately offers no way to set one to a
 * chosen value.
 */
export async function issuePasswordReset(
  actor: AdminActor,
  input: { userId: string; method: "LINK" | "TEMPORARY"; reason?: string | null },
): Promise<PasswordResetResult> {
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { id: true, email: true } });
  if (!user) throw new UserAdminError("That user no longer exists.");

  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 3_600_000);
  const token = input.method === "LINK" ? generateToken() : null;
  const temporaryPassword = input.method === "TEMPORARY" ? generateTemporaryPassword() : null;
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

  await db.$transaction(async (tx) => {
    // Spend, do not delete: a used token is evidence, and the row is what stops
    // an older link from being replayed.
    await tx.userToken.updateMany({
      where: { userId: user.id, purpose: { in: ["PASSWORD_RESET", "INVITE"] }, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (token) {
      await tx.userToken.create({
        data: {
          userId: user.id,
          purpose: "PASSWORD_RESET",
          tokenHash: hashToken(token),
          expiresAt,
          createdById: actor.id,
        },
      });
    }

    if (passwordHash) {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
      });
    } else {
      await tx.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    }

    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    entityType: "User",
    entityId: user.id,
    summary: `Password reset issued for ${user.email} (${input.method === "LINK" ? "reset link" : "temporary password"})`,
    reason: input.reason ?? null,
    // Neither the token nor the password appears here — `redact()` would catch
    // them anyway, but they are simply never passed in.
    after: { method: input.method, expiresAt },
  });

  return { token, temporaryPassword, expiresAt };
}

export async function forceSignOut(actor: AdminActor, input: { userId: string; reason?: string | null }) {
  const user = await db.user.findUnique({ where: { id: input.userId }, select: { email: true } });
  if (!user) throw new UserAdminError("That user no longer exists.");

  const count = await revokeAllSessions(input.userId);

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.USER_SESSIONS_REVOKED,
    entityType: "User",
    entityId: input.userId,
    summary: `${count} session${count === 1 ? "" : "s"} revoked for ${user.email}`,
    reason: input.reason ?? null,
  });

  return count;
}

export async function updateUserProfile(
  actor: AdminActor,
  input: { userId: string; name: string; email: string },
) {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!email.includes("@")) throw new UserAdminError("Enter a valid email address.");
  if (!name) throw new UserAdminError("Enter the person's name.");

  const before = await db.user.findUnique({
    where: { id: input.userId },
    select: { name: true, email: true },
  });
  if (!before) throw new UserAdminError("That user no longer exists.");

  if (email !== before.email) {
    const clash = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (clash && clash.id !== input.userId) {
      throw new UserAdminError("Another account already uses that email address.");
    }
  }

  await db.user.update({ where: { id: input.userId }, data: { name, email } });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: "User",
    entityId: input.userId,
    summary: `${before.email} updated`,
    before,
    after: { name, email },
  });
}

export const ROLE_OPTIONS: { value: CompanyRole; label: string; blurb: string }[] = [
  { value: "PRIMARY", label: "Primary", blurb: "Full access, including users, settings and period close." },
  { value: "SECONDARY", label: "Secondary", blurb: "Day-to-day bookkeeping. Cannot close a period or manage users." },
  { value: "REVIEWER", label: "Reviewer", blurb: "Reads and approves, but does not originate transactions." },
  { value: "ACCOUNTANT", label: "Accountant", blurb: "External practitioner. Sees the firm workspace across clients." },
];
