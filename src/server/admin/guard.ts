/**
 * The platform-admin authorisation boundary.
 *
 * `requirePlatformAdmin()` is to the admin portal what `requireCompany()` is to
 * the accounting app: the single place that answers "is this request allowed
 * here at all". Every admin page, every admin server action and every admin API
 * route calls it — navigation that hides a link is a courtesy, never a control.
 *
 * Being a platform administrator takes three things, all checked on every
 * request rather than baked into the session at sign-in:
 *
 *   1. a live **admin-scope** session (an app session is not one);
 *   2. `isPlatformAdmin` still true — a demotion takes effect immediately;
 *   3. not suspended — a suspended administrator keeps the flag but loses the
 *      portal, so the two are separate columns.
 *
 * A user who must change their password is admitted only to the change-password
 * screen, which is why that page calls `requirePasswordChangeActor()` instead.
 */

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { readAdminSession } from "./session";
import { csrfTokenFor } from "./csrf";
import { isRecentlyVerified } from "./session";

export interface AdminActor {
  id: string;
  name: string;
  email: string;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  /** The live session's token — the CSRF token is derived from it. */
  sessionToken: string;
  csrfToken: string;
  mfaVerifiedAt: Date | null;
  /** True when MFA was satisfied recently enough for a high-risk action. */
  recentlyVerified: boolean;
  platformAdminSince: Date | null;
}

/**
 * Resolve the acting administrator, or null. Deliberately does not redirect —
 * `/admin/login` needs to ask "is someone already signed in" without being
 * bounced by its own guard.
 */
export const getAdminActor = cache(async (): Promise<AdminActor | null> => {
  const session = await readAdminSession();
  if (!session) return null;

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      isPlatformAdmin: true,
      platformAdminSuspendedAt: true,
      platformAdminSince: true,
      mfaEnabled: true,
      mustChangePassword: true,
    },
  });

  if (!user || !user.isPlatformAdmin || user.platformAdminSuspendedAt) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mfaEnabled: user.mfaEnabled,
    mustChangePassword: user.mustChangePassword,
    sessionToken: session.token,
    csrfToken: csrfTokenFor(session.token),
    mfaVerifiedAt: session.mfaVerifiedAt,
    recentlyVerified: isRecentlyVerified(session.mfaVerifiedAt),
    platformAdminSince: user.platformAdminSince,
  };
});

/** Page and action guard. Unauthenticated callers land on the admin sign-in. */
export async function requirePlatformAdmin(): Promise<AdminActor> {
  const actor = await getAdminActor();
  if (!actor) redirect("/admin/login");
  if (actor.mustChangePassword) redirect("/admin/change-password");
  return actor;
}

/** The one guard that tolerates `mustChangePassword` — used only by that screen. */
export async function requirePasswordChangeActor(): Promise<AdminActor> {
  const actor = await getAdminActor();
  if (!actor) redirect("/admin/login");
  return actor;
}

/**
 * Thrown by admin server actions when the caller is not (or is no longer) a
 * platform administrator. Actions return a plain `{ error }` to the form rather
 * than redirecting, so a session that lapsed mid-edit produces a message rather
 * than a silent navigation that loses the user's typing.
 */
export class AdminAuthError extends Error {
  constructor(message = "You are not signed in as a platform administrator.") {
    super(message);
    this.name = "AdminAuthError";
  }
}

/** Guard for server actions. Throws `AdminAuthError` instead of redirecting. */
export async function requireAdminAction(): Promise<AdminActor> {
  const actor = await getAdminActor();
  if (!actor) throw new AdminAuthError();
  if (actor.mustChangePassword) {
    throw new AdminAuthError("Set a new password before making changes.");
  }
  return actor;
}

/**
 * Guard for route handlers under `/api/admin`.
 *
 * Returns a `Response` when the caller is refused so the handler can return it
 * directly: 401 when nobody is signed in, 403 when someone is but is not a
 * platform administrator. A signed-in customer poking at an admin endpoint gets
 * a flat refusal, never data.
 */
export async function requireAdminApi(): Promise<{ actor: AdminActor } | { response: Response }> {
  const session = await readAdminSession();
  if (!session) {
    return {
      response: Response.json({ error: "Authentication required." }, { status: 401 }),
    };
  }
  const actor = await getAdminActor();
  if (!actor) {
    return {
      response: Response.json({ error: "Platform administrator access is required." }, { status: 403 }),
    };
  }
  return { actor };
}

/**
 * Step-up authentication for high-risk changes — granting or withdrawing
 * platform-admin access, and anything else that can lock Red Leaf out of its own
 * console.
 *
 * An administrator with MFA enrolled must have satisfied it recently; one
 * without MFA must re-enter their password, which the calling action collects
 * and verifies. Either way the check is that the person at the keyboard proved
 * themselves *just now*, not merely that a cookie is present.
 */
export function needsStepUp(actor: AdminActor): boolean {
  return actor.mfaEnabled ? !actor.recentlyVerified : true;
}
