/**
 * Login rate limiting and credential-stuffing defence.
 *
 * Counted from the `AuthAttempt` table rather than an in-memory map, because
 * the app runs as serverless functions: an in-process counter would reset on
 * every cold start and would not be shared between concurrent instances, which
 * is precisely the window an attacker would use.
 *
 * Two separate limits, because they catch different attacks:
 *
 *   * **per account** — repeated failures against one email is a targeted
 *     guess. Locks that account's sign-in for a while.
 *   * **per IP** — failures spread thinly across *many* emails never trip the
 *     per-account limit; that is credential stuffing, and counting distinct
 *     emails from one address is what sees it.
 *
 * A lockout is deliberately silent about which limit was hit — the response the
 * caller renders says only "too many attempts", never "this account is locked",
 * which would confirm the account exists.
 */

import "server-only";
import { db } from "@/lib/db";

const WINDOW_MINUTES = 15;
/** Failures against a single email before that email is locked out. */
const MAX_PER_EMAIL = 5;
/** Failures from a single address before the address is locked out. */
const MAX_PER_IP = 20;
/** Distinct emails one address may fail against before it is treated as spraying. */
const MAX_DISTINCT_EMAILS_PER_IP = 5;

export type AuthScope = "APP" | "ADMIN";

export interface AttemptInput {
  email: string;
  scope: AuthScope;
  ip?: string | null;
  userAgent?: string | null;
}

export interface LimitVerdict {
  allowed: boolean;
  /** Seconds until the caller may try again. Only meaningful when blocked. */
  retryAfterSeconds: number;
}

function windowStart(): Date {
  return new Date(Date.now() - WINDOW_MINUTES * 60_000);
}

/**
 * Ask whether this attempt may proceed. Call *before* touching the password.
 *
 * Note this does not itself record anything — `recordAttempt` does that, so a
 * successful sign-in can clear the counter in the same place it is written.
 */
export async function checkLoginAllowed(input: AttemptInput): Promise<LimitVerdict> {
  const since = windowStart();
  const email = input.email.toLowerCase();

  const [emailFailures, ipFailures, sprayed] = await Promise.all([
    db.authAttempt.count({
      where: { email, scope: input.scope, success: false, createdAt: { gte: since } },
    }),
    input.ip
      ? db.authAttempt.count({
          where: { ipAddress: input.ip, success: false, createdAt: { gte: since } },
        })
      : Promise.resolve(0),
    input.ip
      ? db.authAttempt.findMany({
          where: { ipAddress: input.ip, success: false, createdAt: { gte: since } },
          select: { email: true },
          distinct: ["email"],
          take: MAX_DISTINCT_EMAILS_PER_IP + 1,
        })
      : Promise.resolve([]),
  ]);

  const blocked =
    emailFailures >= MAX_PER_EMAIL ||
    ipFailures >= MAX_PER_IP ||
    sprayed.length > MAX_DISTINCT_EMAILS_PER_IP;

  if (!blocked) return { allowed: true, retryAfterSeconds: 0 };

  // Report the remaining window rather than a fixed number, so an attacker
  // cannot use the message to time the next burst precisely.
  const oldest = await db.authAttempt.findFirst({
    where: {
      success: false,
      createdAt: { gte: since },
      ...(emailFailures >= MAX_PER_EMAIL ? { email, scope: input.scope } : { ipAddress: input.ip }),
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const freeAt = (oldest?.createdAt.getTime() ?? Date.now()) + WINDOW_MINUTES * 60_000;
  return { allowed: false, retryAfterSeconds: Math.max(30, Math.ceil((freeAt - Date.now()) / 1000)) };
}

export type AuthOutcome =
  | "OK"
  | "BAD_PASSWORD"
  | "UNKNOWN_USER"
  | "NOT_ADMIN"
  | "MFA_FAILED"
  | "LOCKED_OUT"
  | "SUSPENDED";

/**
 * Record the outcome. A success clears that account's recent failures so a user
 * who eventually remembers their password is not left locked out by their own
 * near misses.
 */
export async function recordAttempt(input: AttemptInput & { outcome: AuthOutcome }): Promise<void> {
  const email = input.email.toLowerCase();
  const success = input.outcome === "OK";

  await db.authAttempt.create({
    data: {
      email,
      scope: input.scope,
      success,
      outcome: input.outcome,
      ipAddress: input.ip ?? undefined,
      userAgent: input.userAgent ?? undefined,
    },
  });

  if (success) {
    await db.authAttempt.deleteMany({
      where: { email, scope: input.scope, success: false, createdAt: { gte: windowStart() } },
    });
  }
}

/**
 * Equalise the time an unknown email and a wrong password take.
 *
 * Without this the "no such user" path returns before bcrypt has run, and the
 * difference is measurable — which turns the login form into an account
 * enumeration oracle no matter how careful the wording is.
 */
export async function equaliseTiming(): Promise<void> {
  const { hashPassword } = await import("@/server/auth/password");
  await hashPassword("timing-equalisation-placeholder");
}

export const LOGIN_LIMITS = {
  windowMinutes: WINDOW_MINUTES,
  maxPerEmail: MAX_PER_EMAIL,
  maxPerIp: MAX_PER_IP,
  maxDistinctEmailsPerIp: MAX_DISTINCT_EMAILS_PER_IP,
};

/** Recent failures against the portal, for the admin security panel. */
export async function recentAdminFailures(limit = 20) {
  return db.authAttempt.findMany({
    where: { scope: "ADMIN", success: false },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, email: true, outcome: true, ipAddress: true, createdAt: true },
  });
}
