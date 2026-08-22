/**
 * Session handling (spec §27).
 *
 * A signed, httpOnly, sameSite cookie carries an opaque session token; the
 * authoritative record lives in the Session table so a session can be revoked
 * server-side (device control) rather than only expiring.
 */

import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
export { hashPassword, verifyPassword } from "./password";

const COOKIE_NAME = "rlf_session";
const SESSION_DAYS = 14;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    // The development fallback is a published constant: anyone reading the
    // source could mint a valid session cookie. Convenient locally, fatal in
    // production, so production refuses to start rather than sign with it.
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production — session cookies cannot be signed with the development fallback.");
    }
    return new TextEncoder().encode("redleaf-development-secret-change-me".padEnd(32, "!"));
  }
  return new TextEncoder().encode(value.padEnd(32, "!"));
}

export async function createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);

  await db.session.create({
    data: { userId, token, expiresAt, userAgent: meta.userAgent, ipAddress: meta.ip },
  });

  const jwt = await new SignJWT({ sid: token, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return token;
}

export async function readSession(): Promise<{ userId: string; token: string } | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  try {
    const { payload } = await jwtVerify(raw, secret());
    const token = payload.sid as string;
    const session = await db.session.findUnique({ where: { token } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    return { userId: session.userId, token };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (raw) {
    try {
      const { payload } = await jwtVerify(raw, secret());
      await db.session.updateMany({
        where: { token: payload.sid as string },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Cookie was already invalid — clearing it below is enough.
    }
  }
  store.delete(COOKIE_NAME);
}
