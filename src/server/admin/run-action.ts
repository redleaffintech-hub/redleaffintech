/**
 * The wrapper every admin server action runs inside.
 *
 * Each action is its own POST endpoint — reachable by anyone who can guess its
 * id, with no layout in front of it — so the three checks that make it safe
 * cannot live in a page or a layout. They live here, and an action that forgets
 * to use this wrapper is an action that forgot to be protected.
 *
 *   1. `requireAdminAction()` — a live admin-scope session belonging to a user
 *      who is *still* an unsuspended platform administrator.
 *   2. `assertCsrf()` — the form's token matches this session.
 *   3. Error translation — domain errors become a sentence the operator can act
 *      on; anything else is logged and reported as a generic failure, so an
 *      internal message (a Prisma constraint, a connection string) never reaches
 *      the browser.
 */

import "server-only";
import { assertCsrf, CsrfError } from "./csrf";
import { AdminAuthError, requireAdminAction, type AdminActor } from "./guard";
import { ClientError } from "./clients";
import { UserAdminError } from "./users";
import { SubscriptionError } from "./subscriptions";
import { AdministratorError } from "./administrators";
import { PlanError } from "@/server/plans/admin";

/**
 * `redirect()` and `notFound()` work by throwing a tagged error. Detected by the
 * digest rather than by importing Next's internal predicate, which lives at a
 * deep path that has moved between releases.
 */
function isControlFlowError(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

export interface AdminActionResult {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Errors whose messages are written for the operator and safe to show. */
const SPEAKABLE = [
  ClientError,
  UserAdminError,
  SubscriptionError,
  AdministratorError,
  PlanError,
  CsrfError,
  AdminAuthError,
];

export async function runAdminAction(
  formData: FormData,
  body: (actor: AdminActor, formData: FormData) => Promise<AdminActionResult | void>,
): Promise<AdminActionResult> {
  let actor: AdminActor;
  try {
    actor = await requireAdminAction();
    await assertCsrf(formData);
  } catch (error) {
    if (error instanceof AdminAuthError || error instanceof CsrfError) {
      return { error: error.message };
    }
    throw error;
  }

  try {
    const result = await body(actor, formData);
    return result ?? { ok: true };
  } catch (error) {
    // `redirect()` works by throwing. Letting it through is the whole point.
    if (isControlFlowError(error)) throw error;

    if (SPEAKABLE.some((type) => error instanceof type)) {
      return { error: (error as Error).message };
    }

    console.error("[admin-action] unhandled", error);
    return { error: "That could not be completed. The details have been logged." };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Form field readers
//
// FormData gives back `string | File | null`. These keep the parsing honest at
// the boundary so an action body never has to wonder what it is holding.
// ─────────────────────────────────────────────────────────────────────────────

export function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalStr(formData: FormData, key: string): string | undefined {
  const value = str(formData, key);
  return value.length > 0 ? value : undefined;
}

export function bool(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

export function int(formData: FormData, key: string, fallback: number | null = null): number | null {
  const raw = str(formData, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

/** Every value for a name shared by several checkboxes — e.g. a set of module toggles. */
export function list(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * A money field typed as dollars, stored as integer cents.
 *
 * Rounding here rather than truncating matters: `19.99` arrives from the browser
 * as `1998.9999999999998` once multiplied, and truncation would quietly price
 * the plan a cent low.
 */
export function cents(formData: FormData, key: string): number | null {
  const raw = str(formData, key).replace(/[^0-9.-]/g, "");
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/** A date field. Parsed as UTC midnight so a timezone cannot shift a trial end. */
export function date(formData: FormData, key: string): Date | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
