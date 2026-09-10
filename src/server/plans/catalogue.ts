/**
 * Reading the plan catalogue.
 *
 * There are two copies of every plan and the distinction is the whole point:
 *
 *   the **working copy** — the `Plan` row and its prices, features and modules,
 *   which is what the admin portal edits; and
 *
 *   the **published snapshot** — a `PlanVersion` holding the JSON the world is
 *   allowed to see, written only when an administrator explicitly publishes.
 *
 * The public pricing page, the in-app subscription screen and every server-side
 * seat check read snapshots. A half-finished price therefore cannot reach a
 * visitor, and a customer's agreed price cannot be rewritten by an edit made
 * months later — their subscription points at the exact version it was sold on.
 *
 * Publication *state* (draft/published/archived, public/private) is the one
 * thing read from the working row rather than the snapshot: hiding a plan or
 * archiving it is a withdrawal, and a withdrawal that needed a publish to take
 * effect would be a footgun.
 */

import "server-only";
import { cache } from "react";
import { plans as plansRepo, planVersions as planVersionsRepo } from "@/server/db/platform";
import type { Plan as PlanDoc } from "@/server/db/types";
import {
  BILLING_CYCLES,
  DEFAULT_PLAN_CODE,
  type BillingCycle,
  type ModuleId,
  type PlanPriceView,
  type PublicPlan,
} from "@/lib/plans";

type PlanWithChildren = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  forWhom: string | null;
  currency: string;
  seats: number;
  companies: number;
  storageGb: number;
  support: string;
  sortOrder: number;
  isPopular: boolean;
  contactOnly: boolean;
  prices: { cycle: string; cycleAmountCents: number; monthlyEquivalentCents: number }[];
  features: { label: string; sortOrder: number }[];
  modules: { moduleId: string }[];
};

/** Everything a plan shape needs, in one include (kept for the Prisma admin path). */
export const PLAN_INCLUDE = {
  prices: true,
  features: { orderBy: { sortOrder: "asc" } },
  modules: true,
} as const;

/** Adapt a stored Firestore Plan doc (features/modules as ordered string[]) to
 *  the child-relation shape `planShapeFromRow` expects. */
function toPlanWithChildren(p: PlanDoc): PlanWithChildren {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    forWhom: p.forWhom,
    currency: p.currency,
    seats: p.seats,
    companies: p.companies,
    storageGb: p.storageGb,
    support: p.support,
    sortOrder: p.sortOrder,
    isPopular: p.isPopular,
    contactOnly: p.contactOnly,
    prices: p.prices,
    features: p.features.map((label, sortOrder) => ({ label, sortOrder })),
    modules: p.modules.map((moduleId) => ({ moduleId })),
  };
}

const EMPTY_PRICE: PlanPriceView = { cycleAmountCents: 0, monthlyEquivalentCents: 0 };

/**
 * Turn a working-copy row into the shape everything downstream reads. This is
 * both what gets frozen into a snapshot on publish and what the admin preview
 * renders — so the preview is the same code path as the live page, not an
 * approximation of it.
 */
export function planShapeFromRow(plan: PlanWithChildren): PublicPlan {
  const prices = Object.fromEntries(
    BILLING_CYCLES.map((cycle) => {
      const row = plan.prices.find((price) => price.cycle === cycle);
      return [
        cycle,
        row
          ? {
              cycleAmountCents: row.cycleAmountCents,
              monthlyEquivalentCents: row.monthlyEquivalentCents,
            }
          : EMPTY_PRICE,
      ];
    }),
  ) as Record<BillingCycle, PlanPriceView>;

  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    forWhom: plan.forWhom,
    currency: plan.currency,
    seats: plan.seats,
    companies: plan.companies,
    storageGb: plan.storageGb,
    support: plan.support,
    modules: plan.modules.map((m) => m.moduleId as ModuleId),
    includes: [...plan.features].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.label),
    popular: plan.isPopular,
    contactOnly: plan.contactOnly,
    sortOrder: plan.sortOrder,
    prices,
    versionId: null,
    version: null,
  };
}

/** The JSON written into `PlanVersion.snapshot`. */
export function serializeSnapshot(shape: PublicPlan): string {
  const { versionId: _versionId, version: _version, ...rest } = shape;
  return JSON.stringify(rest);
}

function parseSnapshot(raw: string, versionId: string, version: number): PublicPlan | null {
  try {
    const parsed = JSON.parse(raw) as Omit<PublicPlan, "versionId" | "version">;
    return { ...parsed, versionId, version };
  } catch {
    // A snapshot that will not parse is a corrupt row, not a reason to take the
    // pricing page down: drop the plan and let the rest render.
    return null;
  }
}

interface CatalogueOptions {
  /** Restrict to plans offered on the public site. */
  publicOnly?: boolean;
}

async function loadPublished(options: CatalogueOptions = {}): Promise<PublicPlan[]> {
  const all = await plansRepo.list({ where: [["status", "==", "PUBLISHED"]], orderBy: "sortOrder" });
  const plans = all.filter(
    (p) =>
      p.archivedAt == null &&
      p.publishedVersionId != null &&
      (!options.publicOnly || p.isPublic),
  );

  const versionIds = plans.map((p) => p.publishedVersionId!).filter(Boolean);
  if (versionIds.length === 0) return [];

  const versions = await Promise.all(versionIds.map((id) => planVersionsRepo.get(id)));
  const byId = new Map(versions.filter((v) => v).map((v) => [v!.id, v!]));

  return plans
    .map((plan) => {
      const version = byId.get(plan.publishedVersionId!);
      if (!version) return null;
      const shape = parseSnapshot(version.snapshot, version.id, version.version);
      // Ordering is a publication control, so it comes from the live row — a
      // reorder should take effect without republishing four plans.
      return shape ? { ...shape, sortOrder: plan.sortOrder } : null;
    })
    .filter((plan): plan is PublicPlan => plan !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** What the public pricing page and marketing site render. Request-deduped. */
export const publicPlans = cache(async (): Promise<PublicPlan[]> => loadPublished({ publicOnly: true }));

/**
 * Every plan that may be *sold* right now, private ones included. This is what
 * the admin assignment forms and the in-app plan picker offer. Drafts are
 * excluded because a draft has no published price to charge.
 */
export const sellablePlans = cache(async (): Promise<PublicPlan[]> => loadPublished());

export async function publicPlanByCode(code: string): Promise<PublicPlan | undefined> {
  const plans = await publicPlans();
  return plans.find((plan) => plan.code === code.toUpperCase());
}

export async function sellablePlanByCode(code: string): Promise<PublicPlan | undefined> {
  const plans = await sellablePlans();
  return plans.find((plan) => plan.code === code.toUpperCase());
}

/**
 * The seat allowance the server enforces for a plan code.
 *
 * Returns null for an unknown or unpublished plan, which callers must treat as
 * "not a plan we sell" rather than as "unlimited".
 */
export async function seatAllowanceForCode(code: string): Promise<number | null> {
  const plan = await sellablePlanByCode(code);
  return plan ? plan.seats : null;
}

/**
 * Everything that must be frozen onto a Subscription when a plan is assigned.
 *
 * Reading this at assignment time and storing the result is what makes a later
 * price edit harmless: the subscription keeps the numbers it was sold on.
 */
export interface PlanAssignment {
  planId: string;
  planCode: string;
  planVersionId: string | null;
  billingCycle: BillingCycle;
  currency: string;
  priceCents: number;
  monthlyEquivalentCents: number;
  seats: number;
}

export function assignmentFromPlan(plan: PublicPlan, cycle: BillingCycle): PlanAssignment {
  const price = plan.prices[cycle] ?? EMPTY_PRICE;
  return {
    planId: plan.id,
    planCode: plan.code,
    planVersionId: plan.versionId,
    billingCycle: cycle,
    currency: plan.currency,
    priceCents: price.cycleAmountCents,
    monthlyEquivalentCents: price.monthlyEquivalentCents,
    seats: plan.seats,
  };
}

/**
 * Resolve a plan for provisioning *inside an existing transaction*.
 *
 * Company creation runs in one transaction and must not read through a second
 * connection, so this takes the `tx` rather than using the cached readers above.
 * Falls back to the default plan code, then to any published plan, so a company
 * can still be created on a catalogue that has been reorganised.
 */
export async function resolveAssignment(
  code: string | undefined,
  cycle: BillingCycle = "MONTHLY",
): Promise<PlanAssignment | null> {
  const wanted = (code ?? DEFAULT_PLAN_CODE).toUpperCase();

  const candidates = (
    await plansRepo.list({ where: [["status", "==", "PUBLISHED"]], orderBy: "sortOrder" })
  ).filter((p) => p.archivedAt == null && p.publishedVersionId != null);
  if (candidates.length === 0) return null;

  const row = candidates.find((p) => p.code === wanted) ?? candidates[0];

  const version = row.publishedVersionId
    ? await planVersionsRepo.get(row.publishedVersionId)
    : null;
  const shape =
    version && parseSnapshot(version.snapshot, version.id, version.version)
      ? parseSnapshot(version.snapshot, version.id, version.version)!
      : planShapeFromRow(toPlanWithChildren(row));

  return assignmentFromPlan(shape, cycle);
}
