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
import { db } from "@/lib/db";
import { isSupportedCurrency, normalizeCurrency } from "@/lib/currency";
import { BILLING_CYCLES, MODULES, type BillingCycle, type ModuleId } from "@/lib/plans";
import { AUDIT_ACTIONS, recordPlatformAudit } from "@/server/admin/audit";
import type { AdminActor } from "@/server/admin/guard";
import { PLAN_INCLUDE, planShapeFromRow, serializeSnapshot } from "./catalogue";

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
  const plans = await db.plan.findMany({
    orderBy: [{ archivedAt: "asc" }, { sortOrder: "asc" }],
    include: {
      ...PLAN_INCLUDE,
      _count: { select: { subscriptions: true, versions: true } },
    },
  });
  return plans;
}

export async function getPlanForAdmin(planId: string) {
  return db.plan.findUnique({
    where: { id: planId },
    include: {
      ...PLAN_INCLUDE,
      versions: { orderBy: { version: "desc" }, take: 10 },
      _count: { select: { subscriptions: true } },
    },
  });
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

async function writeChildren(planId: string, input: PlanInput, tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) {
  // Prices, features and modules are small, ordered sets with no identity of
  // their own — replacing them wholesale is simpler and less error-prone than
  // diffing, and it happens inside the same transaction as the parent write.
  await tx.planPrice.deleteMany({ where: { planId } });
  await tx.planPrice.createMany({
    data: BILLING_CYCLES.map((cycle) => ({
      planId,
      cycle,
      cycleAmountCents: input.prices[cycle].cycleAmountCents,
      monthlyEquivalentCents: input.prices[cycle].monthlyEquivalentCents,
    })),
  });

  await tx.planFeature.deleteMany({ where: { planId } });
  if (input.features.length > 0) {
    await tx.planFeature.createMany({
      data: input.features.map((label, index) => ({ planId, label, sortOrder: index * 10 })),
    });
  }

  await tx.planModule.deleteMany({ where: { planId } });
  if (input.modules.length > 0) {
    await tx.planModule.createMany({
      data: input.modules.map((moduleId) => ({ planId, moduleId })),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / update
// ─────────────────────────────────────────────────────────────────────────────

export async function createPlan(actor: AdminActor, raw: PlanInput) {
  const input = validate(raw);

  const clash = await db.plan.findUnique({ where: { code: input.code }, select: { id: true } });
  if (clash) throw new PlanError(`A plan with the code ${input.code} already exists.`);

  const plan = await db.$transaction(async (tx) => {
    const created = await tx.plan.create({
      data: { ...planScalars(input), status: "DRAFT", hasDraftChanges: true },
    });
    await writeChildren(created.id, input, tx);
    return created;
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

  const before = await db.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!before) throw new PlanError("That plan no longer exists.");

  if (before.code !== input.code) {
    const referenced = await db.subscription.count({ where: { planId } });
    if (referenced > 0) {
      // The code is the identifier entitlement checks and stored subscriptions
      // use. Renaming it under a live subscription silently unlinks them.
      throw new PlanError(
        `${referenced} subscription${referenced === 1 ? "" : "s"} reference this plan, so its code cannot change. Create a new plan instead.`,
      );
    }
    const clash = await db.plan.findUnique({ where: { code: input.code }, select: { id: true } });
    if (clash) throw new PlanError(`A plan with the code ${input.code} already exists.`);
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.plan.update({
      where: { id: planId },
      data: {
        ...planScalars(input),
        // The edit is a draft change until it is published — even on a plan that
        // is already live, whose visitors keep seeing the last published version.
        hasDraftChanges: true,
      },
    });
    await writeChildren(planId, input, tx);
    return row;
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_UPDATED,
    entityType: "Plan",
    entityId: planId,
    summary: `Plan ${input.code} edited (unpublished)`,
    before: planShapeFromRow(before),
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

export async function publishPlan(actor: AdminActor, planId: string) {
  const plan = await db.plan.findUnique({ where: { id: planId }, include: PLAN_INCLUDE });
  if (!plan) throw new PlanError("That plan no longer exists.");
  if (plan.archivedAt) throw new PlanError("Reactivate this plan before publishing it.");

  const shape = planShapeFromRow(plan);
  if (!plan.contactOnly && BILLING_CYCLES.some((cycle) => shape.prices[cycle].cycleAmountCents === 0)) {
    throw new PlanError("Every billing cycle needs a price before this plan can be published.");
  }

  const version = await db.$transaction(async (tx) => {
    const last = await tx.planVersion.findFirst({
      where: { planId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const created = await tx.planVersion.create({
      data: {
        planId,
        version: (last?.version ?? 0) + 1,
        snapshot: serializeSnapshot(shape),
        publishedById: actor.id,
      },
    });
    await tx.plan.update({
      where: { id: planId },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        publishedVersionId: created.id,
        hasDraftChanges: false,
        archivedAt: null,
      },
    });
    return created;
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

  const plan = await db.plan.findUnique({
    where: { id: planId },
    select: { id: true, code: true, status: true, _count: { select: { subscriptions: true } } },
  });
  if (!plan) throw new PlanError("That plan no longer exists.");

  await db.plan.update({
    where: { id: planId },
    data: { status: "ARCHIVED", archivedAt: new Date(), isPublic: false },
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.PLAN_ARCHIVED,
    entityType: "Plan",
    entityId: planId,
    summary: `Plan ${plan.code} archived (${plan._count.subscriptions} subscription${
      plan._count.subscriptions === 1 ? "" : "s"
    } keep their agreed terms)`,
    reason: trimmed,
    before: { status: plan.status },
    after: { status: "ARCHIVED" },
  });

  revalidatePricing();
}

export async function reactivatePlan(actor: AdminActor, planId: string) {
  const plan = await db.plan.findUnique({
    where: { id: planId },
    select: { id: true, code: true, publishedVersionId: true },
  });
  if (!plan) throw new PlanError("That plan no longer exists.");

  await db.plan.update({
    where: { id: planId },
    data: {
      archivedAt: null,
      // A plan that was never published comes back as a draft, not as something
      // suddenly on sale again.
      status: plan.publishedVersionId ? "PUBLISHED" : "DRAFT",
    },
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
  const plan = await db.plan.findUnique({ where: { id: planId }, select: { code: true, isPublic: true } });
  if (!plan) throw new PlanError("That plan no longer exists.");

  await db.plan.update({ where: { id: planId }, data: { isPublic } });

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

  await db.$transaction(
    clean.map((entry) =>
      db.plan.update({ where: { id: entry.planId }, data: { sortOrder: entry.sortOrder } }),
    ),
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
  const plan = await db.plan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      code: true,
      status: true,
      publishedVersionId: true,
      _count: { select: { subscriptions: true, versions: true } },
    },
  });
  if (!plan) throw new PlanError("That plan no longer exists.");

  if (plan._count.subscriptions > 0) {
    throw new PlanError(
      `${plan._count.subscriptions} subscription${
        plan._count.subscriptions === 1 ? " references" : "s reference"
      } this plan. Archive it instead — deleting it would take their agreed pricing with it.`,
    );
  }
  if (plan._count.versions > 0 || plan.publishedVersionId) {
    throw new PlanError("This plan has been published before. Archive it instead so its history survives.");
  }

  await db.plan.delete({ where: { id: planId } });

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
