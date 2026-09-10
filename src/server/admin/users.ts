/**
 * User and membership administration.
 *
 * The membership row is still the authorisation — a platform admin grants access
 * by writing `companyUsers`, the same record `requireCompany()` reads. And a
 * client is never locked out of their own file: any op that would remove the
 * last active PRIMARY is refused (unless the whole subscription is off).
 */

import "server-only";
import { COMPANY_ROLES, type CompanyRole } from "@/lib/enums";
import { hashPassword } from "@/server/auth/password";
import {
  createUser as createUserDoc,
  getUser as getUserDoc,
  updateUser,
} from "@/server/db/users";
import {
  deleteMembership,
  getMembership,
  listMembershipsForCompany,
  listMembershipsForUser,
  upsertMembership,
} from "@/server/db/company-users";
import { getCompany } from "@/server/db/companies";
import {
  createUserToken,
  getSubscriptionForCompany,
  revokeSessionsForUser,
  spendUserTokens,
} from "@/server/db/platform";
import { recordAudit } from "@/server/db/audit-logs";
import { db, top } from "@/server/db/firestore";
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

const membershipId = (companyId: string, userId: string) => `${companyId}__${userId}`;
const splitMembershipId = (id: string): [string, string] => {
  const i = id.indexOf("__");
  return [id.slice(0, i), id.slice(i + 2)];
};

// ── Reading ────────────────────────────────────────────────────────────────

export interface UserFilters {
  q?: string;
  companyId?: string;
  page?: number;
  perPage?: number;
  platformAdminsOnly?: boolean;
}

const ts = (t: FirebaseFirestore.Timestamp | null | undefined) => t?.toDate?.() ?? null;

export async function listUsers(filters: UserFilters) {
  const perPage = Math.min(Math.max(filters.perPage ?? 25, 5), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const q = filters.q?.trim().toLowerCase();

  const [userSnap, cuSnap, companySnap] = await Promise.all([
    top("users").get(),
    top("companyUsers").get(),
    db.collection("companies").get(),
  ]);
  const companyName = new Map(companySnap.docs.map((d) => [d.id, d.data().name as string]));
  const membershipsByUser = new Map<string, { role: string; status: string; company: { id: string; name: string } }[]>();
  for (const d of cuSnap.docs) {
    const c = d.data();
    const list = membershipsByUser.get(c.userId) ?? [];
    list.push({
      role: c.role,
      status: c.status,
      company: { id: c.companyId, name: companyName.get(c.companyId) ?? "—" },
    });
    membershipsByUser.set(c.userId, list);
  }

  let rows = userSnap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      name: x.name as string,
      email: x.email as string,
      isPlatformAdmin: (x.isPlatformAdmin as boolean) ?? false,
      platformAdminSuspendedAt: ts(x.platformAdminSuspendedAt),
      mfaEnabled: (x.mfaEnabled as boolean) ?? false,
      mustChangePassword: (x.mustChangePassword as boolean) ?? false,
      lastLoginAt: ts(x.lastLoginAt),
      createdAt: ts(x.createdAt) ?? new Date(0),
      companyUsers: membershipsByUser.get(d.id) ?? [],
    };
  });

  if (q) rows = rows.filter((r) => r.email.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  if (filters.companyId) {
    rows = rows.filter((r) => r.companyUsers.some((m) => m.company.id === filters.companyId));
  }
  if (filters.platformAdminsOnly) rows = rows.filter((r) => r.isPlatformAdmin);

  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const total = rows.length;

  return {
    rows: rows.slice((page - 1) * perPage, page * perPage),
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function getUserForAdmin(userId: string) {
  const user = await getUserDoc(userId);
  if (!user) return null;

  const [memberships, sessionSnap] = await Promise.all([
    listMembershipsForUser(userId),
    top("sessions").where("userId", "==", userId).get(),
  ]);

  const companies = await Promise.all(memberships.map((m) => getCompany(m.companyId)));
  const subs = await Promise.all(memberships.map((m) => getSubscriptionForCompany(m.companyId)));

  const companyUsers = memberships
    .map((m, i) => ({
      id: membershipId(m.companyId, m.userId),
      role: m.role,
      status: m.status,
      createdAt: m.createdAt,
      invitedAt: m.invitedAt,
      acceptedAt: m.acceptedAt,
      company: {
        id: m.companyId,
        name: companies[i]?.name ?? "—",
        subscription: subs[i]
          ? { status: subs[i]!.status, plan: subs[i]!.plan, seats: subs[i]!.seats }
          : null,
      },
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const now = new Date();
  const sessions = sessionSnap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        scope: x.scope as string,
        ipAddress: (x.ipAddress as string | null) ?? null,
        userAgent: (x.userAgent as string | null) ?? null,
        createdAt: ts(x.createdAt) ?? new Date(0),
        lastSeenAt: ts(x.lastSeenAt),
        revokedAt: ts(x.revokedAt),
        expiresAt: ts(x.expiresAt) ?? new Date(0),
      };
    })
    .filter((s) => !s.revokedAt && s.expiresAt > now)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10)
    .map(({ revokedAt: _r, expiresAt: _e, ...rest }) => {
      void _r;
      void _e;
      return rest;
    });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isPlatformAdmin: user.isPlatformAdmin,
    platformAdminSince: user.platformAdminSince,
    platformAdminSuspendedAt: user.platformAdminSuspendedAt,
    mfaEnabled: user.mfaEnabled,
    mfaEnrolledAt: user.mfaEnrolledAt,
    mustChangePassword: user.mustChangePassword,
    passwordChangedAt: user.passwordChangedAt,
    lastLoginAt: user.lastLoginAt,
    activeCompanyId: user.activeCompanyId,
    createdAt: user.createdAt,
    companyUsers,
    sessions,
  };
}

// ── Guards ─────────────────────────────────────────────────────────────────

async function assertNotLastPrimary(
  companyId: string,
  userId: string,
  role: string,
  status: string,
  action: string,
) {
  if (role !== "PRIMARY" || status !== "ACTIVE") return;
  const [members, subscription] = await Promise.all([
    listMembershipsForCompany(companyId),
    getSubscriptionForCompany(companyId),
  ]);
  const otherPrimaries = members.filter(
    (m) => m.role === "PRIMARY" && m.status === "ACTIVE" && m.userId !== userId,
  ).length;
  if (otherPrimaries > 0) return;
  if (subscription && ["SUSPENDED", "CANCELLED"].includes(subscription.status)) return;
  throw new UserAdminError(
    `This is the company's only active primary user. Assign another primary user before you ${action}.`,
  );
}

async function seatUsage(companyId: string) {
  const [members, subscription] = await Promise.all([
    listMembershipsForCompany(companyId),
    getSubscriptionForCompany(companyId),
  ]);
  const used = members.filter((m) => ["ACTIVE", "INVITED"].includes(m.status)).length;
  return { used, allowed: subscription?.seats ?? null, subscription };
}

// ── Creating users ─────────────────────────────────────────────────────────

export interface CreateUserResult {
  userId: string;
  temporaryPassword: string | null;
  inviteToken: string | null;
  existed: boolean;
}

export async function createUser(
  actor: AdminActor,
  input: { name: string; email: string; method: "INVITE" | "TEMPORARY" },
): Promise<CreateUserResult> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (!email.includes("@")) throw new UserAdminError("Enter a valid email address.");
  if (!name) throw new UserAdminError("Enter the person's name.");

  const existing = await top("users").where("email", "==", email).limit(1).get();
  if (!existing.empty) {
    return { userId: existing.docs[0].id, temporaryPassword: null, inviteToken: null, existed: true };
  }

  const useInvite = input.method === "INVITE";
  const temporaryPassword = useInvite ? null : generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword ?? generateToken());
  const inviteToken = useInvite ? generateToken() : null;

  const user = await createUserDoc({ email, name, passwordHash, mustChangePassword: true });
  if (inviteToken) {
    await createUserToken({
      userId: user.id,
      purpose: "INVITE",
      tokenHash: hashToken(inviteToken),
      expiresAt: new Date(Date.now() + INVITE_TOKEN_HOURS * 3_600_000),
      usedAt: null,
      createdById: actor.id,
    });
  }

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

// ── Memberships ────────────────────────────────────────────────────────────

export async function grantMembership(
  actor: AdminActor,
  input: { userId: string; companyId: string; role: string; allowSeatOverage?: boolean },
) {
  if (!(COMPANY_ROLES as readonly string[]).includes(input.role)) {
    throw new UserAdminError("That is not a role this product has.");
  }

  const [user, company, existing] = await Promise.all([
    getUserDoc(input.userId),
    getCompany(input.companyId),
    getMembership(input.companyId, input.userId),
  ]);
  if (!user) throw new UserAdminError("That user no longer exists.");
  if (!company) throw new UserAdminError("That client no longer exists.");
  if (existing && existing.status === "ACTIVE") {
    throw new UserAdminError(`${user.email} already has access to ${company.name}.`);
  }

  const { used, allowed } = await seatUsage(input.companyId);
  if (allowed !== null && used >= allowed && !input.allowSeatOverage) {
    throw new UserAdminError(
      `${company.name} is using ${used} of ${allowed} seats. Raise the seat allowance on the subscription before adding another person.`,
    );
  }

  const membership = await upsertMembership({
    companyId: input.companyId,
    userId: input.userId,
    role: input.role,
    status: "ACTIVE",
    invitedAt: existing?.invitedAt ?? new Date(),
    acceptedAt: new Date(),
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
  await recordAudit({
    companyId: input.companyId,
    userId: null,
    action: "CREATE",
    entityType: "CompanyUser",
    entityId: membership.id,
    summary: `${user.email} was granted ${input.role} access by Red Leaf support`,
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
  const [companyId, userId] = splitMembershipId(input.membershipId);
  const membership = await getMembership(companyId, userId);
  if (!membership) throw new UserAdminError("That membership no longer exists.");
  if (membership.role === input.role) throw new UserAdminError("That is already their role.");

  if (membership.role === "PRIMARY") {
    await assertNotLastPrimary(companyId, userId, membership.role, membership.status, "change this role");
  }

  const [user, company] = await Promise.all([getUserDoc(userId), getCompany(companyId)]);
  const membershipDocId = membershipId(companyId, userId);
  await upsertMembership({ ...membership, role: input.role });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.MEMBERSHIP_ROLE_CHANGED,
    entityType: "CompanyUser",
    entityId: membershipDocId,
    summary: `${user?.email ?? userId} in ${company?.name ?? companyId}: ${membership.role} → ${input.role}`,
    before: { role: membership.role },
    after: { role: input.role },
  });
  await recordAudit({
    companyId,
    action: "UPDATE",
    entityType: "CompanyUser",
    entityId: membershipDocId,
    summary: `${user?.email ?? userId} changed from ${membership.role} to ${input.role} by Red Leaf support`,
  });

  return { ...membership, role: input.role };
}

export async function setMembershipStatus(
  actor: AdminActor,
  input: { membershipId: string; status: "ACTIVE" | "SUSPENDED"; reason?: string | null },
) {
  const [companyId, userId] = splitMembershipId(input.membershipId);
  const membership = await getMembership(companyId, userId);
  if (!membership) throw new UserAdminError("That membership no longer exists.");
  if (membership.status === input.status) throw new UserAdminError("That is already their status.");

  if (input.status === "SUSPENDED") {
    if (!input.reason?.trim()) throw new UserAdminError("Give a reason for suspending someone's access.");
    await assertNotLastPrimary(companyId, userId, membership.role, membership.status, "suspend this person");
  }

  const [user, company] = await Promise.all([getUserDoc(userId), getCompany(companyId)]);
  await upsertMembership({ ...membership, status: input.status });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action:
      input.status === "SUSPENDED"
        ? AUDIT_ACTIONS.MEMBERSHIP_SUSPENDED
        : AUDIT_ACTIONS.MEMBERSHIP_REACTIVATED,
    entityType: "CompanyUser",
    entityId: input.membershipId,
    summary: `${user?.email ?? userId} access to ${company?.name ?? companyId} ${
      input.status === "SUSPENDED" ? "suspended" : "reactivated"
    }`,
    reason: input.reason ?? null,
    before: { status: membership.status },
    after: { status: input.status },
  });

  return { ...membership, status: input.status };
}

export async function removeMembership(
  actor: AdminActor,
  input: { membershipId: string; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new UserAdminError("Give a reason for removing someone's access.");

  const [companyId, userId] = splitMembershipId(input.membershipId);
  const membership = await getMembership(companyId, userId);
  if (!membership) throw new UserAdminError("That membership no longer exists.");

  await assertNotLastPrimary(companyId, userId, membership.role, membership.status, "remove this person");

  const [user, company] = await Promise.all([getUserDoc(userId), getCompany(companyId)]);
  await deleteMembership(companyId, userId);
  if (user?.activeCompanyId === companyId) {
    await updateUser(userId, { activeCompanyId: null });
  }

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.MEMBERSHIP_REMOVED,
    entityType: "CompanyUser",
    entityId: input.membershipId,
    summary: `${user?.email ?? userId} removed from ${company?.name ?? companyId}`,
    reason,
    before: { role: membership.role, status: membership.status },
  });
  await recordAudit({
    companyId,
    action: "UPDATE",
    entityType: "CompanyUser",
    entityId: input.membershipId,
    summary: `${user?.email ?? userId} was removed from the company by Red Leaf support`,
  });
}

// ── Credentials ────────────────────────────────────────────────────────────

export interface PasswordResetResult {
  token: string | null;
  temporaryPassword: string | null;
  expiresAt: Date;
}

export async function issuePasswordReset(
  actor: AdminActor,
  input: { userId: string; method: "LINK" | "TEMPORARY"; reason?: string | null },
): Promise<PasswordResetResult> {
  const user = await getUserDoc(input.userId);
  if (!user) throw new UserAdminError("That user no longer exists.");

  const expiresAt = new Date(Date.now() + RESET_TOKEN_HOURS * 3_600_000);
  const token = input.method === "LINK" ? generateToken() : null;
  const temporaryPassword = input.method === "TEMPORARY" ? generateTemporaryPassword() : null;
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

  await spendUserTokens(user.id, ["PASSWORD_RESET", "INVITE"]);
  if (token) {
    await createUserToken({
      userId: user.id,
      purpose: "PASSWORD_RESET",
      tokenHash: hashToken(token),
      expiresAt,
      usedAt: null,
      createdById: actor.id,
    });
  }
  await updateUser(
    user.id,
    passwordHash
      ? { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() }
      : { mustChangePassword: true },
  );
  await revokeSessionsForUser(user.id);

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    entityType: "User",
    entityId: user.id,
    summary: `Password reset issued for ${user.email} (${input.method === "LINK" ? "reset link" : "temporary password"})`,
    reason: input.reason ?? null,
    after: { method: input.method, expiresAt },
  });

  return { token, temporaryPassword, expiresAt };
}

export async function forceSignOut(
  actor: AdminActor,
  input: { userId: string; reason?: string | null },
) {
  const user = await getUserDoc(input.userId);
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

  const before = await getUserDoc(input.userId);
  if (!before) throw new UserAdminError("That user no longer exists.");

  if (email !== before.email) {
    const clash = await top("users").where("email", "==", email).limit(1).get();
    if (!clash.empty && clash.docs[0].id !== input.userId) {
      throw new UserAdminError("Another account already uses that email address.");
    }
    // Move the email-uniqueness guard doc.
    await top("userEmails").doc(email).set({ userId: input.userId });
    await top("userEmails").doc(before.email).delete().catch(() => {});
  }

  await updateUser(input.userId, { name, email });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.USER_UPDATED,
    entityType: "User",
    entityId: input.userId,
    summary: `${before.email} updated`,
    before: { name: before.name, email: before.email },
    after: { name, email },
  });
}

export const ROLE_OPTIONS: { value: CompanyRole; label: string; blurb: string }[] = [
  { value: "PRIMARY", label: "Primary", blurb: "Full access, including users, settings and period close." },
  { value: "SECONDARY", label: "Secondary", blurb: "Day-to-day bookkeeping. Cannot close a period or manage users." },
  { value: "REVIEWER", label: "Reviewer", blurb: "Reads and approves, but does not originate transactions." },
  { value: "ACCOUNTANT", label: "Accountant", blurb: "External practitioner. Sees the firm workspace across clients." },
];

