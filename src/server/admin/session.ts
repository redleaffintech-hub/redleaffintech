/**
 * Platform-administrator sessions.
 *
 * A *separate* session from the accounting app's — different cookie, a
 * `redleaf-platform-admin` audience in the signed payload, and `scope: "ADMIN"`
 * on the `sessions/{token}` doc. Much shorter‑lived: twelve hours absolute, one
 * hour idle.
 */

import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import {
  createSession as createSessionDoc,
  getSessionByToken,
  revokeSessionsForUser,
  updateSession,
} from "@/server/db/platform";
import { updateUser } from "@/server/db/users";

export const ADMIN_COOKIE = "rlf_admin";
const ADMIN_AUDIENCE = "redleaf-platform-admin";
const ABSOLUTE_HOURS = 12;
const IDLE_MINUTES = 60;
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
  mfaVerified?: boolean;
}

export async function createAdminSession(
  userId: string,
  meta: AdminSessionMeta = {},
): Promise<string> {
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ABSOLUTE_HOURS * 3_600_000);

  await createSessionDoc({
    token,
    userId,
    scope: "ADMIN",
    userAgent: meta.userAgent ?? null,
    ipAddress: meta.ip ?? null,
    mfaVerifiedAt: meta.mfaVerified ? now : null,
    lastSeenAt: now,
    expiresAt,
    revokedAt: null,
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

  await updateUser(userId, { lastLoginAt: now });
  return token;
}

export interface AdminSessionRecord {
  userId: string;
  token: string;
  mfaVerifiedAt: Date | null;
}

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

  const session = await getSessionByToken(token);
  if (!session || session.scope !== "ADMIN") return null;

  const now = new Date();
  if (session.revokedAt || session.expiresAt < now) return null;

  const idleSince = session.lastSeenAt ?? session.createdAt;
  if (now.getTime() - idleSince.getTime() > IDLE_MINUTES * 60_000) {
    await updateSession(token, { revokedAt: now });
    return null;
  }

  if (now.getTime() - idleSince.getTime() > 60_000) {
    await updateSession(token, { lastSeenAt: now });
  }

  return { userId: session.userId, token: session.id, mfaVerifiedAt: session.mfaVerifiedAt };
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(ADMIN_COOKIE)?.value;
  if (raw) {
    try {
      const { payload } = await jwtVerify(raw, secret(), { audience: ADMIN_AUDIENCE });
      await updateSession(payload.sid as string, { revokedAt: new Date() });
    } catch {
      // Already unreadable — clearing the cookie below is the whole remedy.
    }
  }
  store.delete({ name: ADMIN_COOKIE, path: "/admin" });
}

export async function markMfaVerified(token: string): Promise<void> {
  await updateSession(token, { mfaVerifiedAt: new Date() });
}

export function isRecentlyVerified(mfaVerifiedAt: Date | null): boolean {
  if (!mfaVerifiedAt) return false;
  return Date.now() - mfaVerifiedAt.getTime() <= STEP_UP_MINUTES * 60_000;
}

export const STEP_UP_WINDOW_MINUTES = STEP_UP_MINUTES;

/** Revoke every session a user holds, in both portals. */
export async function revokeAllSessions(userId: string): Promise<number> {
  return revokeSessionsForUser(userId);
}

/** Revoke only the admin-scope sessions — used when admin rights are removed. */
export async function revokeAdminSessions(userId: string): Promise<number> {
  return revokeSessionsForUser(userId, "ADMIN");
}
