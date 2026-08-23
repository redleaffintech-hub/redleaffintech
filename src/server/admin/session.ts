/**
 * Platform-administrator sessions.
 *
 * Deliberately a *separate* session from the accounting app's, not a flag on
 * it. Signing in to the product must not silently confer the platform portal,
 * and signing out of the portal must not log an administrator out of a client
 * file they were legitimately working in. They ride on different cookies, carry
 * different audiences in the signed payload, and are stored as different
 * `Session.scope` values — so an app cookie replayed against `/admin` is not a
 * session at all, rather than being a session that merely fails a later check.
 *
 * Admin sessions are also much shorter-lived than app sessions: twelve hours
 * absolute, one hour idle. A console that can suspend a client company should
 * not sit signed in overnight.
 */

import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";

export const ADMIN_COOKIE = "rlf_admin";
const ADMIN_AUDIENCE = "redleaf-platform-admin";
const ABSOLUTE_HOURS = 12;
const IDLE_MINUTES = 60;
/** How recently MFA must have been satisfied for a high-risk action. */
const STEP_UP_MINUTES = 15;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET must be set in production — admin session cookies cannot be signed with the development fallback.",
      );
    }
    return new TextEncoder().encode("redleaf-development-secret-change-me".padEnd(32, "!"));
  }
  return new TextEncoder().encode(value.padEnd(32, "!"));
}

export interface AdminSessionMeta {
  userAgent?: string | null;
  ip?: string | null;
  /** True when MFA was satisfied as part of this sign-in. */
  mfaVerified?: boolean;
}

export async function createAdminSession(userId: string, meta: AdminSessionMeta = {}): Promise<string> {
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ABSOLUTE_HOURS * 3_600_000);

  await db.session.create({
    data: {
      userId,
      token,
      scope: "ADMIN",
      userAgent: meta.userAgent ?? undefined,
      ipAddress: meta.ip ?? undefined,
      mfaVerifiedAt: meta.mfaVerified ? now : null,
      lastSeenAt: now,
      expiresAt,
    },
  });

  const jwt = await new SignJWT({ sid: token, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(ADMIN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ABSOLUTE_HOURS}h`)
    .sign(secret());

  const store = await cookies();
  store.set(ADMIN_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    expires: expiresAt,
  });

  await db.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
  return token;
}

export interface AdminSessionRecord {
  userId: string;
  token: string;
  mfaVerifiedAt: Date | null;
}

/**
 * Read and *renew* the current admin session.
 *
 * The idle window slides on every read, which is why this writes: an
 * administrator working continuously stays signed in, one who walks away is
 * signed out an hour later without waiting for the absolute expiry.
 */
export async function readAdminSession(): Promise<AdminSessionRecord | null> {
  const store = await cookies();
  const raw = store.get(ADMIN_COOKIE)?.value;
  if (!raw) return null;

  let token: string;
  try {
    const { payload } = await jwtVerify(raw, secret(), { audience: ADMIN_AUDIENCE });
    token = payload.sid as string;
  } catch {
    return null;
  }
  if (!token) return null;

  const session = await db.session.findUnique({ where: { token } });
  if (!session || session.scope !== "ADMIN") return null;

  const now = new Date();
  if (session.revokedAt || session.expiresAt < now) return null;

  const idleSince = session.lastSeenAt ?? session.createdAt;
  if (now.getTime() - idleSince.getTime() > IDLE_MINUTES * 60_000) {
    await db.session.update({ where: { token }, data: { revokedAt: now } });
    return null;
  }

  // Only write when the clock has actually moved, so a page composed of many
  // server components does not turn one request into a dozen updates.
  if (now.getTime() - idleSince.getTime() > 60_000) {
    await db.session.update({ where: { token }, data: { lastSeenAt: now } });
  }

  return { userId: session.userId, token: session.token, mfaVerifiedAt: session.mfaVerifiedAt };
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(ADMIN_COOKIE)?.value;
  if (raw) {
    try {
      const { payload } = await jwtVerify(raw, secret(), { audience: ADMIN_AUDIENCE });
      await db.session.updateMany({
        where: { token: payload.sid as string },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Already unreadable — clearing the cookie below is the whole remedy.
    }
  }
  store.delete({ name: ADMIN_COOKIE, path: "/admin" });
}

/** Record that MFA was satisfied again, for step-up on a high-risk action. */
export async function markMfaVerified(token: string): Promise<void> {
  await db.session.update({ where: { token }, data: { mfaVerifiedAt: new Date() } });
}

export function isRecentlyVerified(mfaVerifiedAt: Date | null): boolean {
  if (!mfaVerifiedAt) return false;
  return Date.now() - mfaVerifiedAt.getTime() <= STEP_UP_MINUTES * 60_000;
}

export const STEP_UP_WINDOW_MINUTES = STEP_UP_MINUTES;

/**
 * Revoke every session a user holds, in both portals.
 *
 * Used by "force sign-out", by password resets, and whenever platform-admin
 * access is withdrawn — a privilege change that leaves a live session behind
 * has not actually taken effect.
 */
export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Revoke only the admin-scope sessions — used when admin rights are removed. */
export async function revokeAdminSessions(userId: string): Promise<number> {
  const result = await db.session.updateMany({
    where: { userId, scope: "ADMIN", revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
