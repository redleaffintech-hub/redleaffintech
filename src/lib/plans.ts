/**
 * The Red Leaf plan catalogue — shapes and constants only.
 *
 * The plans themselves used to be a hard-coded `PLANS` array in this file. They
 * now live in the database (models `Plan`, `PlanPrice`, `PlanFeature`,
 * `PlanModule`, `PlanVersion`) and are edited in the platform-admin portal, so
 * the price a visitor is quoted, the seat count the server enforces and the
 * figure on a subscription can never drift apart.
 *
 * What is left here is everything that is genuinely static — the billing cycles
 * and the product shelf — plus the `PublicPlan` shape that both the server
 * (`src/server/plans/catalogue.ts`) and the client components consume. Nothing
 * in this module knows a price.
 *
 * Prices are integer minor units of the plan's currency, per `./money.ts`.
 */

export const BILLING_CYCLES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const CYCLE_LABELS: Record<BillingCycle, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
};

/** How many months one invoice covers. */
export const CYCLE_MONTHS: Record<BillingCycle, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

/** "billed every 3 months" — the phrasing used wherever the real charge is shown. */
export const CYCLE_BILLED_AS: Record<BillingCycle, string> = {
  MONTHLY: "billed monthly",
  QUARTERLY: "billed every 3 months",
  ANNUAL: "billed annually",
};

export const MODULES = [
  "ACCOUNTING",
  "PAYROLL",
  "HR",
  "TAX",
  "PAYMENTS",
  "BANKING",
  "INVENTORY",
] as const;
export type ModuleId = (typeof MODULES)[number];

export interface ModuleInfo {
  id: ModuleId;
  name: string;
  blurb: string;
  icon: string;
  available: boolean;
}

/** The product shelf, in the order the client listed it. */
export const MODULE_CATALOG: ModuleInfo[] = [
  {
    id: "ACCOUNTING",
    name: "Red Leaf Accounting",
    blurb:
      "General ledger, A/R, A/P, invoicing, expenses, bank reconciliation and the full financial statement pack.",
    icon: "ledger",
    available: true,
  },
  {
    id: "PAYROLL",
    name: "Red Leaf Payroll",
    blurb: "Pay runs, source deductions, T4s and ROEs, posting straight to the ledger.",
    icon: "wallet",
    available: false,
  },
  {
    id: "HR",
    name: "Red Leaf HR",
    blurb: "Employee records, time off and org structure in one place — no payroll calculations yet.",
    icon: "users",
    available: true,
  },
  {
    id: "TAX",
    name: "Red Leaf Tax",
    blurb: "Corporate and sales tax preparation built on the same ledger the returns are filed from.",
    icon: "percent",
    available: false,
  },
  {
    id: "PAYMENTS",
    name: "Red Leaf Payments",
    blurb: "Take card and bank payments on invoices, with settlement reconciled automatically.",
    icon: "card",
    available: false,
  },
  {
    id: "BANKING",
    name: "Red Leaf Banking",
    blurb: "Direct bank connections, balances and payment initiation without the CSV round trip.",
    icon: "bank",
    available: false,
  },
  {
    id: "INVENTORY",
    name: "Red Leaf Inventory",
    blurb: "Stock on hand, costing and cost of goods sold posted as it moves.",
    icon: "box",
    available: false,
  },
];

export const MODULE_NAMES: Record<string, string> = Object.fromEntries(
  MODULE_CATALOG.map((module) => [module.id, module.name]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Plan lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DRAFT   — never been published; invisible everywhere but the admin portal.
 * PUBLISHED — has a live snapshot. `isPublic` then decides whether the public
 *             pricing page lists it; a private published plan can still be
 *             assigned to a client by a platform administrator.
 * ARCHIVED — withdrawn from sale. Existing subscriptions keep working, which is
 *            why a referenced plan is archived rather than deleted.
 */
export const PLAN_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

/**
 * The plan code a company gets when nothing else is specified. It is an
 * identifier, not a definition — the seats and the price behind it come from
 * the database like every other plan's.
 */
export const DEFAULT_PLAN_CODE = "PROFESSIONAL";

// ─────────────────────────────────────────────────────────────────────────────
// The shape everything reads
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanPriceView {
  /** What one invoice for this cycle actually charges. */
  cycleAmountCents: number;
  /** The comparable per-month figure the pricing page leads with. Display only. */
  monthlyEquivalentCents: number;
}

/**
 * A plan as the marketing site, the in-app subscription screen and the admin
 * assignment forms all see it. Built either from a published `PlanVersion`
 * snapshot or, in the admin preview, from the unsaved working copy — which is
 * exactly why the preview can be trusted to look like the real thing.
 */
export interface PublicPlan {
  /** Plan row id. Stable, but `code` is what subscriptions key off. */
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
  modules: ModuleId[];
  /** The bullet list on the card, in order. */
  includes: string[];
  popular: boolean;
  contactOnly: boolean;
  sortOrder: number;
  prices: Record<BillingCycle, PlanPriceView>;
  /** Which published version this shape came from. Null for an admin preview. */
  versionId: string | null;
  version: number | null;
}

/** What one invoice costs for a plan on a given cycle. */
export function cyclePriceCents(plan: PublicPlan, cycle: BillingCycle): number {
  return plan.prices[cycle]?.cycleAmountCents ?? 0;
}

/** The per-month figure to display for a cycle. */
export function monthlyEquivalentCents(plan: PublicPlan, cycle: BillingCycle): number {
  return plan.prices[cycle]?.monthlyEquivalentCents ?? 0;
}

/** Whole-percent saving against paying monthly. 0 when there is none. */
export function cycleSavingPercent(plan: PublicPlan, cycle: BillingCycle): number {
  const monthly = plan.prices.MONTHLY?.monthlyEquivalentCents ?? 0;
  const target = plan.prices[cycle]?.monthlyEquivalentCents ?? 0;
  if (!monthly || !target) return 0;
  return Math.round((1 - target / monthly) * 100);
}

export function isValidCycle(value: string | null | undefined): value is BillingCycle {
  return !!value && (BILLING_CYCLES as readonly string[]).includes(value);
}

export function planByCode(plans: PublicPlan[], code: string | null | undefined): PublicPlan | undefined {
  if (!code) return undefined;
  const wanted = code.toUpperCase();
  return plans.find((plan) => plan.code === wanted);
}
