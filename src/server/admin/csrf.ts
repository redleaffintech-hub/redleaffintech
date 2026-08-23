/**
 * CSRF protection for admin mutations.
 *
 * Next's Server Actions already verify the Origin against the Host, which stops
 * the classic cross-site form post. This adds the second, independent check —
 * a signed token bound to the current admin session — so that a mistake in
 * origin handling, a proxy that rewrites headers, or a future `/api/admin`
 * route handler (which gets no such protection at all) is not the only thing
 * standing between an attacker's page and a suspended client company.
 *
 * The token is *derived* rather than stored: an HMAC of the session token under
 * the app secret. That means no extra cookie to set (a server component cannot
 * write one anyway), nothing to expire separately, and a token that is useless
 * the moment its session ends.
 */

import "server-only";
import { createHmac } from "crypto";
import { readAdminSession } from "./session";
import { safeEqual } from "./crypto";
import { CSRF_FIELD } from "@/lib/admin-constants";

export { CSRF_FIELD };

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production — CSRF tokens cannot be signed without it.");
    }
    return "redleaf-development-secret-change-me";
  }
  return value;
}

export function csrfTokenFor(sessionToken: string): string {
  return createHmac("sha256", secret()).update(`csrf:${sessionToken}`).digest("base64url");
}

export class CsrfError extends Error {
  constructor() {
    super("This form has expired. Reload the page and try again.");
    this.name = "CsrfError";
  }
}

/**
 * Verify the token a form submitted against the caller's live session.
 *
 * Throws rather than returning a flag: a mutation must not be able to proceed
 * by forgetting to check the result.
 */
export async function assertCsrf(formData: FormData): Promise<void> {
  const submitted = formData.get(CSRF_FIELD);
  if (typeof submitted !== "string" || submitted.length === 0) throw new CsrfError();

  const session = await readAdminSession();
  if (!session) throw new CsrfError();

  if (!safeEqual(submitted, csrfTokenFor(session.token))) throw new CsrfError();
}
