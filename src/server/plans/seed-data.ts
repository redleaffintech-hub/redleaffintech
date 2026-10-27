/**
 * The plan catalogue: one Basic plan plus Payroll and Inventory add-ons
 * (27 Oct 2026 fee structure). The four earlier tiers (Starter, Professional,
 * Business, Firm) are no longer seeded; existing subscriptions on them keep
 * their plan rows and agreed prices.
 *
 * Originally: the founding plan catalogue.
 *
 * These are the four plans that used to be the hard-coded `PLANS` array in
 * `src/lib/plans.ts`. They live here now for one purpose only: seeding a
 * database that has no plans yet. Nothing at runtime reads this file — the
 * marketing site, the app and the entitlement checks all go through
 * `src/server/plans/catalogue.ts`, which reads published `PlanVersion`
 * snapshots. Editing a number here changes nothing until it is seeded, and
 * re-seeding never overwrites a plan an administrator has since edited.
 *
 * Prices are integer cents of CAD and remain the placeholders the client has
 * not yet replaced. Quarterly is ~8% off the monthly rate and annual ~17% (two
 * months free), which is the shape the pricing toggle demonstrates.
 */

import { CYCLE_MONTHS, type BillingCycle, type ModuleId } from "@/lib/plans";

export interface SeedPlan {
  code: string;
  name: string;
  description: string;
  forWhom: string;
  currency: string;
  /** Per-month price in cents for each billing cycle. */
  monthlyEquivalentCents: Record<BillingCycle, number>;
  seats: number;
  companies: number;
  storageGb: number;
  modules: ModuleId[];
  support: string;
  includes: string[];
  popular?: boolean;
  contactOnly?: boolean;
  sortOrder: number;
}

export const SEED_PLANS: SeedPlan[] = [
  {
    code: "BASIC",
    name: "Basic",
    description: "The full Canadian accounting product. Add Payroll and Inventory when you need them.",
    forWhom: "Any Canadian business keeping its own books.",
    currency: "CAD",
    // Billed $19.99 monthly or $199.99 annually (~$16.67/month).
    monthlyEquivalentCents: { MONTHLY: 1999, ANNUAL: 1667 },
    seats: 3,
    companies: 1,
    storageGb: 5,
    modules: ["ACCOUNTING"],
    support: "Email support",
    includes: [
      "Invoicing, sales quotes and expenses",
      "Bank import, rules and reconciliation",
      "GST/HST, PST, RST and QST tax engine",
      "Balance sheet, P&L and cash flow",
      "Bill approvals, budgets and period close",
    ],
    popular: true,
    sortOrder: 10,
  },
];

export interface SeedAddon {
  code: string;
  name: string;
  description: string;
  moduleId: ModuleId;
  monthlyCents: number;
  annualCents: number;
  sortOrder: number;
}

export const SEED_ADDONS: SeedAddon[] = [
  {
    code: "PAYROLL",
    name: "Payroll",
    description: "Pay runs posting straight to the ledger, with pay stubs and leave tracking.",
    moduleId: "PAYROLL",
    monthlyCents: 1499,
    annualCents: 14999,
    sortOrder: 10,
  },
  {
    code: "INVENTORY",
    name: "Inventory",
    description: "Stock on hand at weighted-average cost, with cost of goods sold posted as it sells.",
    moduleId: "INVENTORY",
    monthlyCents: 2999,
    annualCents: 29999,
    sortOrder: 20,
  },
];

/** The seed quotes a per-month rate; the amount actually billed follows from it. */
export function seedCycleAmountCents(plan: SeedPlan, cycle: BillingCycle): number {
  // Annual is a stated price ($199.99), not 12 x the rounded monthly equivalent.
  if (plan.code === "BASIC" && cycle === "ANNUAL") return 19_999;
  return plan.monthlyEquivalentCents[cycle] * CYCLE_MONTHS[cycle];
}
