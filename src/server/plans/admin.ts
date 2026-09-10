/**
 * Editing the plan catalogue.
 *
 * Every write here touches the *working copy* only. Nothing an administrator
 * types reaches a visitor until `publishPlan` freezes it into a `PlanVersion` —
 * which is what makes it safe to revise a price over several saves, or to leave
 * a half-drafted plan sitting there over a weekend.
 *
 * Two rules that are enforced rather than merely documented:
 *
 *   * A plan a subscription points at is **never deleted**, only archived.
 *     Deleting it would orphan the price snapshot a customer agreed to.
 *   * Publishing writes a new version rather than updating the last one, so the
 *     history of what was on sale, and when, stays intact.
 */

import "server-only";
import { revalidatePath } from "next/cache";
import {
  listPlanVersions,
  planVersions as planVersionsRepo,
  plans as plansRepo,
  subscriptions as subsRepo,
} from "@/server/db/platform";
import { newId } from "@/server/db/firestore";
import type { Plan as PlanDoc, PlanVersion } from "@/server/db/types";
import { isSupportedCurrency, normalizeCurrency } from "@/lib/currency";
import { BILLING_CYCLES, MODULES, type BillingCycle, type ModuleId } from "@/lib/plans";
import { AUDIT_ACTIONS, recordPlatformAudit } from "@/server/admin/audit";
import type { AdminActor } from "@/server/admin/guard";
import { planShapeFromRow, serializeSnapshot, toPlanWithChildren } from "./catalogue";

async function planCounts(planId: string): Promise<{ subscriptions: number; versions: number }> {
  const [subs, versions] = await Promise.all([
    subsRepo.list({ where: [["planId", "==", planId]] }),
    listPlanVersions(planId),
  ]);
  return { subscriptions: subs.length, versions: versions.length };
}

/** The admin-page shape: the plan doc with `_count` and (optionally) versions. */
async function withAdminShape(p: PlanDoc, includeVersions = false) {
  const _count = await planCounts(p.id);
  const versions = includeVersions ? (await listPlanVersions(p.id)).slice(0, 10) : [];
  const children = toPlanWithChildren(p);
  return { ...p, prices: children.prices, features: children.features, modules: children.modules, _count, versions };
}

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

/** Every page the catalogue is visible on, refreshed the moment it changes. */
function revalidatePricing() {
  revalidatePath("/pricing");
  revalidatePath("/");
  revalidatePath("/products");
  revalidatePath("/products/accounting");
  revalidatePath("/signup");
  revalidatePath("/company/subscription");
  revalidatePath("/admin/plans");
}

export async function listPlansForAdmin() {
  const all = await plansRepo.list({ orderBy: "sortOrder" });
  all.sort(
    (a, b) =>
      Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.sortOrder - b.sortOrder,
  );
  return Promise.all(all.map((p) => withAdminShape(p)));
}

export async function getPlanForAdmin(planId: string) {
  const p = await plansRepo.get(planId);
  return p ? withAdminShape(p, true) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanInput {
  code: string;
  name: string;
  description?: string | null;
  forWhom?: string | null;
  currency: string;
  seats: number;
  companies: number;
  storageGb: number;
  support: string;
  modules: string[];
  features: string[];
  isPopular: boolean;
  contactOnly: boolean;
  isPublic: boolean;
  sortOrder: number;
  prices: Record<BillingCycle, { cycleAmountCents: number; monthlyEquivalentCents: number }>;
}

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/;

/**
 * Server-side validation of everything a plan form can send.
 *
 * The client form validates too, but only this matters: a plan is the price the
 * business charges, and a negative seat allowance or a price of `NaN` reaching
 * the database is not a cosmetic problem.
 */
function validate(input: PlanInput): PlanInput {
  const code = input.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new PlanError(
      "The plan code must be 2–32 characters, start with a letter, and use only capitals, digits and underscores.",
    );
  }

  const name = input.name.trim();
  if (!name) throw new PlanError("The plan needs a public name.");
  if (name.length > 60) throw new PlanError("Keep the plan name under 60 characters.");

  const currency = normalizeCurrency(input.currency);
  if (!currency || !isSupportedCurrency(currency)) {
    throw new PlanError("Choose a valid ISO 4217 currency.");
  }

  for (const [field, value] of [
    ["Seat allowance", input.seats],
    ["Company allowance", input.companies],
    ["Storage allowance", input.storageGb],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new PlanError(`${field} must be a whole number of at least 1.`);
    }
    if (value > 100_000) throw new PlanError(`${field} is implausibly large.`);
  }

  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
    throw new PlanError("Display order must be zero or a positive whole number.");
  }

  const modules = input.modules.filter((module): module is ModuleId =>
    (MODULES as readonly string[]).includes(module),
  );

  const prices = {} as PlanInput["prices"];
  for (const cycle of BILLING_CYCLES) {
    const price = input.prices[cycle];
    if (!price) throw new PlanError(`Set a price for the ${cycle.toLowerCase()} cycle.`);
    for (const [label, amount] of [
      ["billed amount", price.cycleAmountCents],
      ["monthly equivalent", price.monthlyEquivalentCents],
    ] as const) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new PlanError(`The ${cycle.toLowerCase()} ${label} must be a whole number of cents, and cannot be negative.`);
      }
      if (amount > 100_000_00) throw new PlanError(`The ${cycle.toLowerCase()} ${label} is implausibly large.`);
    }
    // A contact-sales plan is allowed to quote nothing; a self-serve one is not,
    // because the pricing page would render a free plan.
    if (!input.contactOnly && price.cycleAmountCents === 0) {
      throw new PlanError(
        `The ${cycle.toLowerCase()} price is zero. Either set a price or mark the plan as contact-sales only.`,
      );
    }
    prices[cycle] = {
      cycleAmountCents: price.cycleAmountCents,
      monthlyEquivalentCents: price.monthlyEquivalentCents,
    };
  }

  return {
    ...input,
    code,
    name,
    description: input.description?.trim() || null,
    forWhom: input.forWhom?.trim() || null,
    currency,
    support: input.support.trim() || "Email support",
    modules,
    features: input.features.map((feature) => feature.trim()).filter(Boolean).slice(0, 20),
    prices,
  };
}

function planScalars(input: PlanInput) {
  return {
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    forWhom: input.forWhom ?? null,
    currency: input.currency,
    seats: input.seats,
    companies: input.companies,
    storageGb: input.storageGb,
    support: input.support,
    isPopular: input.isPopular,
    contactOnly: input.contactOnly,
    isPublic: input.isPublic,
    sortOrder: input.sortOrder,
  };
}

/**
 * Prices, features and modules are small ordered sets embedded on the plan doc,
 * so an edit just replaces the three arrays alongside the scalar write.
 */
function childrenPayload(input: PlanInput) {
  return {
    prices: BILLING_CYCLES.map((cycle) => ({
      cycle,
      cycleAmountCents: input.prices[cycle].cycleAmountCents,
      monthlyEquivalentCents: input.prices[cycle].monthlyEquivalentCents,
    })),
    features: input.features,
    modules: input.modules,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / update
// ─────────────────────────────────────────────────────────────────────────────

export async function createPlan(actor: AdminActor, raw: PlanInput) {
  const input = validate(raw);

  const clash = (await plansRepo.list({ where: [["code", "==", input.code]], limit: 1 }))[0];
  if (clash) throw new PlanError(`A plan with the code ${input.code} already exists.`);

  const id = newId();
  const plan = await plansRepo.create({
    id,
    ...planScalars(input),
    ...childrenPayload(input),
    status: "DRAFT",
    hasDraftChanges: true,
    publishedAt: null,
    publishedVersionId: null,
    archivedAt: null,
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_CREATED,
    entityType: "Plan",
    entityId: plan.id,
    summary: `Plan ${input.code} created as a draft`,
    after: input,
  });

  revalidatePath("/admin/plans");
  return plan;
}

export async function updatePlan(actor: AdminActor, planId: string, raw: PlanInput) {
  const input = validate(raw);

  const before = await plansRepo.get(planId);
  if (!before) throw new PlanError("That plan no longer exists.");

  if (before.code !== input.code) {
    const referenced = (await subsRepo.list({ where: [["planId", "==", planId]] })).length;
    if (referenced > 0) {
      // The code is the identifier entitlement checks and stored subscriptions
      // use. Renaming it under a live subscription silently unlinks them.
      throw new PlanError(
        `${referenced} subscription${referenced === 1 ? "" : "s"} reference this plan, so its code cannot change. Create a new plan instead.`,
      );
    }
    const clash = (await plansRepo.list({ where: [["code", "==", input.code]], limit: 1 }))[0];
    if (clash) throw new PlanError(`A plan with the code ${input.code} already exists.`);
  }

  await plansRepo.update(planId, {
    ...planScalars(input),
    ...childrenPayload(input),
    hasDraftChanges: true,
  });
  const updated = await plansRepo.get(planId);

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: "Plan",
    entityId: planId,
    summary: `Plan ${input.code} edited (unpublished)`,
    before: planShapeFromRow(toPlanWithChildren(before)),
    after: input,
  });

  // Visibility and ordering take effect immediately, so the public page is
  // refreshed even though the *content* change is still a draft.
  revalidatePricing();
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Publishing
// ─────────────────────────────────────────────────────────────────────────────

export async function publishPlan(actor: AdminActor, planId: string): Promise<PlanVersion> {
  const plan = await plansRepo.get(planId);
  if (!plan) throw new PlanError("That plan no longer exists.");
  if (plan.archivedAt) throw new PlanError("Reactivate this plan before publishing it.");

  const shape = planShapeFromRow(toPlanWithChildren(plan));
  if (!plan.contactOnly && BILLING_CYCLES.some((cycle) => shape.prices[cycle].cycleAmountCents === 0)) {
    throw new PlanError("Every billing cycle needs a price before this plan can be published.");
  }

  const last = (await listPlanVersions(planId))[0];
  const version = (await planVersionsRepo.create({
    id: newId(),
    planId,
    version: (last?.version ?? 0) + 1,
    snapshot: serializeSnapshot(shape),
    publishedById: actor.id,
  })) as PlanVersion;
  await plansRepo.update(planId, {
    status: "PUBLISHED",
    publishedAt: new Date(),
    publishedVersionId: version.id,
    hasDraftChanges: false,
    archivedAt: null,
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_PUBLISHED,
    entityType: "Plan",
    entityId: planId,
    summary: `Plan ${plan.code} published as version ${version.version}`,
    after: { version: version.version, prices: shape.prices, seats: shape.seats },
  });

  revalidatePricing();
  return version;
}

export async function archivePlan(actor: AdminActor, planId: string, reason: string) {
  const trimmed = reason?.trim();
  if (!trimmed) throw new PlanError("Record why this plan is being withdrawn from sale.");

  const plan = await plansRepo.get(planId);
  if (!plan) throw new PlanError("That plan no longer exists.");
  const subCount = (await subsRepo.list({ where: [["planId", "==", planId]] })).length;

  await plansRepo.update(planId, { status: "ARCHIVED", archivedAt: new Date(), isPublic: false });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_ARCHIVED,
    entityType: "Plan",
    entityId: planId,
    summary: `Plan ${plan.code} archived (${subCount} subscription${subCount === 1 ? "" : "s"} keep their agreed terms)`,
    reason: trimmed,
    before: { status: plan.status },
    after: { status: "ARCHIVED" },
  });

  revalidatePricing();
}

export async function reactivatePlan(actor: AdminActor, planId: string) {
  const plan = await plansRepo.get(planId);
  if (!plan) throw new PlanError("That plan no longer exists.");

  await plansRepo.update(planId, {
    archivedAt: null,
    status: plan.publishedVersionId ? "PUBLISHED" : "DRAFT",
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_REACTIVATED,
    entityType: "Plan",
    entityId: planId,
    summary: `Plan ${plan.code} reactivated`,
  });

  revalidatePricing();
}

export async function setPlanVisibility(actor: AdminActor, planId: string, isPublic: boolean) {
  const plan = await plansRepo.get(planId);
  if (!plan) throw new PlanError("That plan no longer exists.");

  await plansRepo.update(planId, { isPublic });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_VISIBILITY_CHANGED,
    entityType: "Plan",
    entityId: planId,
    summary: `Plan ${plan.code} ${isPublic ? "shown on" : "hidden from"} the public pricing page`,
    before: { isPublic: plan.isPublic },
    after: { isPublic },
  });

  revalidatePricing();
}

export async function reorderPlans(actor: AdminActor, order: { planId: string; sortOrder: number }[]) {
  const clean = order.filter((entry) => Number.isInteger(entry.sortOrder) && entry.sortOrder >= 0);
  if (clean.length === 0) throw new PlanError("Nothing to reorder.");

  await Promise.all(
    clean.map((entry) => plansRepo.update(entry.planId, { sortOrder: entry.sortOrder })),
  );

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_REORDERED,
    entityType: "Plan",
    summary: `${clean.length} plans reordered`,
    after: clean,
  });

  revalidatePricing();
}

/**
 * Delete a plan outright.
 *
 * Only ever allowed for a mistake — a draft that was never published and that
 * nothing points at. Anything else is archived, because deleting a plan a
 * subscription references would take that customer's agreed price with it.
 */
export async function deletePlan(actor: AdminActor, planId: string) {
  const plan = await plansRepo.get(planId);
  if (!plan) throw new PlanError("That plan no longer exists.");
  const counts = await planCounts(planId);

  if (counts.subscriptions > 0) {
    throw new PlanError(
      `${counts.subscriptions} subscription${
        counts.subscriptions === 1 ? " references" : "s reference"
      } this plan. Archive it instead — deleting it would take their agreed pricing with it.`,
    );
  }
  if (counts.versions > 0 || plan.publishedVersionId) {
    throw new PlanError("This plan has been published before. Archive it instead so its history survives.");
  }

  await plansRepo.remove(planId);

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_ARCHIVED,
    entityType: "Plan",
    entityId: planId,
    summary: `Unpublished draft plan ${plan.code} deleted`,
  });

  revalidatePath("/admin/plans");
}
