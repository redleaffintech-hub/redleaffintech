/**
 * The platform-admin audit trail.
 *
 * Separate from the tenant-scoped `AuditLog` on purpose: these entries cross
 * companies, name a Red Leaf employee rather than a customer's user, and must
 * survive that employee's account being deleted — hence the denormalised
 * `actorEmail`.
 *
 * Two invariants the rest of the portal depends on:
 *
 *   * **Nothing sensitive is ever written.** Every before/after payload goes
 *     through `redact()`, which drops password hashes, tokens, secrets and
 *     anything else whose key looks like a credential. An audit log that leaks
 *     is worse than no audit log.
 *   * **Recording never breaks the action.** A failure to write the trail is
 *     logged to the server console and swallowed; refusing to suspend a
 *     fraudulent account because the audit insert timed out is the wrong
 *     trade. The action itself is already committed by then.
 */

import "server-only";
import { headers } from "next/headers";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";

/** Anything whose key matches is replaced, at any depth. */
const SENSITIVE_KEY = /pass(word)?|hash|secret|token|otp|mfa|apikey|api_key|authorization|cookie|card|cvv|iban/i;

/** Anything JSON-serialisable. Widened deliberately: callers pass domain objects
 *  and arrays, and forcing them through a string-keyed record only invites casts. */
export type AuditPayload = unknown;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[deep]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

function encode(payload: AuditPayload): string | null {
  if (payload === null || payload === undefined) return null;
  try {
    return JSON.stringify(redact(payload));
  } catch {
    return null;
  }
}

/** Request metadata, best-effort. Absent behind some proxies, never required. */
export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null; requestId: string }> {
  try {
    const list = await headers();
    const forwarded = list.get("x-forwarded-for");
    return {
      // The left-most entry is the client; the rest are proxies that appended
      // themselves. Anything after the first comma is not the caller.
      ip: forwarded ? forwarded.split(",")[0].trim() : (list.get("x-real-ip") ?? null),
      userAgent: list.get("user-agent"),
      requestId: list.get("x-request-id") ?? list.get("x-nf-request-id") ?? randomUUID(),
    };
  } catch {
    return { ip: null, userAgent: null, requestId: randomUUID() };
  }
}

export interface PlatformAuditInput {
  actorUserId: string | null;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  /** Mandatory for suspension, cancellation and entitlement overrides. */
  reason?: string | null;
  before?: AuditPayload;
  after?: AuditPayload;
}

export async function recordPlatformAudit(input: PlatformAuditInput): Promise<void> {
  try {
    const meta = await requestMeta();
    await db.platformAuditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        reason: input.reason ?? null,
        beforeJson: encode(input.before),
        afterJson: encode(input.after),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      },
    });
  } catch (error) {
    console.error("[platform-audit] failed to record", input.action, error);
  }
}

/**
 * The actions the portal records. Kept as a closed list so the audit filter can
 * offer them and so a typo cannot silently create a category nobody reviews.
 */
export const AUDIT_ACTIONS = {
  ADMIN_LOGIN_SUCCESS: "ADMIN_LOGIN_SUCCESS",
  ADMIN_LOGIN_FAILURE: "ADMIN_LOGIN_FAILURE",
  ADMIN_LOGOUT: "ADMIN_LOGOUT",
  ADMIN_MFA_ENROLLED: "ADMIN_MFA_ENROLLED",
  ADMIN_MFA_DISABLED: "ADMIN_MFA_DISABLED",
  ADMIN_PROMOTED: "ADMIN_PROMOTED",
  ADMIN_SUSPENDED: "ADMIN_SUSPENDED",
  ADMIN_REINSTATED: "ADMIN_REINSTATED",
  ADMIN_DEMOTED: "ADMIN_DEMOTED",
  CLIENT_CREATED: "CLIENT_CREATED",
  CLIENT_UPDATED: "CLIENT_UPDATED",
  CLIENT_READONLY_CHANGED: "CLIENT_READONLY_CHANGED",
  USER_CREATED: "USER_CREATED",
  USER_UPDATED: "USER_UPDATED",
  USER_PASSWORD_RESET: "USER_PASSWORD_RESET",
  USER_SESSIONS_REVOKED: "USER_SESSIONS_REVOKED",
  MEMBERSHIP_GRANTED: "MEMBERSHIP_GRANTED",
  MEMBERSHIP_ROLE_CHANGED: "MEMBERSHIP_ROLE_CHANGED",
  MEMBERSHIP_SUSPENDED: "MEMBERSHIP_SUSPENDED",
  MEMBERSHIP_REACTIVATED: "MEMBERSHIP_REACTIVATED",
  MEMBERSHIP_REMOVED: "MEMBERSHIP_REMOVED",
  PLAN_CREATED: "PLAN_CREATED",
  PLAN_UPDATED: "PLAN_UPDATED",
  PLAN_PUBLISHED: "PLAN_PUBLISHED",
  PLAN_ARCHIVED: "PLAN_ARCHIVED",
  PLAN_REACTIVATED: "PLAN_REACTIVATED",
  PLAN_VISIBILITY_CHANGED: "PLAN_VISIBILITY_CHANGED",
  PLAN_REORDERED: "PLAN_REORDERED",
  SUBSCRIPTION_CREATED: "SUBSCRIPTION_CREATED",
  SUBSCRIPTION_PLAN_CHANGED: "SUBSCRIPTION_PLAN_CHANGED",
  SUBSCRIPTION_STATUS_CHANGED: "SUBSCRIPTION_STATUS_CHANGED",
  SUBSCRIPTION_TRIAL_EXTENDED: "SUBSCRIPTION_TRIAL_EXTENDED",
  SUBSCRIPTION_SEATS_OVERRIDDEN: "SUBSCRIPTION_SEATS_OVERRIDDEN",
  SUBSCRIPTION_PERIOD_CHANGED: "SUBSCRIPTION_PERIOD_CHANGED",
  SUBSCRIPTION_CANCELLED: "SUBSCRIPTION_CANCELLED",
  SUBSCRIPTION_NOTE_ADDED: "SUBSCRIPTION_NOTE_ADDED",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Human labels for the audit filter and the log itself. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  ADMIN_LOGIN_SUCCESS: "Admin signed in",
  ADMIN_LOGIN_FAILURE: "Admin sign-in failed",
  ADMIN_LOGOUT: "Admin signed out",
  ADMIN_MFA_ENROLLED: "MFA enrolled",
  ADMIN_MFA_DISABLED: "MFA disabled",
  ADMIN_PROMOTED: "Platform admin granted",
  ADMIN_SUSPENDED: "Platform admin suspended",
  ADMIN_REINSTATED: "Platform admin reinstated",
  ADMIN_DEMOTED: "Platform admin removed",
  CLIENT_CREATED: "Client created",
  CLIENT_UPDATED: "Client updated",
  CLIENT_READONLY_CHANGED: "Client read-only changed",
  USER_CREATED: "User created",
  USER_UPDATED: "User updated",
  USER_PASSWORD_RESET: "Password reset issued",
  USER_SESSIONS_REVOKED: "Sessions revoked",
  MEMBERSHIP_GRANTED: "Access granted",
  MEMBERSHIP_ROLE_CHANGED: "Role changed",
  MEMBERSHIP_SUSPENDED: "Access suspended",
  MEMBERSHIP_REACTIVATED: "Access reactivated",
  MEMBERSHIP_REMOVED: "Access removed",
  PLAN_CREATED: "Plan created",
  PLAN_UPDATED: "Plan updated",
  PLAN_PUBLISHED: "Plan published",
  PLAN_ARCHIVED: "Plan archived",
  PLAN_REACTIVATED: "Plan reactivated",
  PLAN_VISIBILITY_CHANGED: "Plan visibility changed",
  PLAN_REORDERED: "Plans reordered",
  SUBSCRIPTION_CREATED: "Subscription created",
  SUBSCRIPTION_PLAN_CHANGED: "Plan assigned",
  SUBSCRIPTION_STATUS_CHANGED: "Status changed",
  SUBSCRIPTION_TRIAL_EXTENDED: "Trial extended",
  SUBSCRIPTION_SEATS_OVERRIDDEN: "Seats overridden",
  SUBSCRIPTION_PERIOD_CHANGED: "Period changed",
  SUBSCRIPTION_CANCELLED: "Subscription cancelled",
  SUBSCRIPTION_NOTE_ADDED: "Note added",
};

/** Which actions read as a security event rather than routine administration. */
export const SENSITIVE_ACTIONS = new Set<string>([
  AUDIT_ACTIONS.ADMIN_LOGIN_FAILURE,
  AUDIT_ACTIONS.ADMIN_PROMOTED,
  AUDIT_ACTIONS.ADMIN_SUSPENDED,
  AUDIT_ACTIONS.ADMIN_DEMOTED,
  AUDIT_ACTIONS.ADMIN_MFA_DISABLED,
  AUDIT_ACTIONS.USER_PASSWORD_RESET,
  AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED,
  AUDIT_ACTIONS.SUBSCRIPTION_SEATS_OVERRIDDEN,
  AUDIT_ACTIONS.MEMBERSHIP_REMOVED,
]);
