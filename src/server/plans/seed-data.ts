/**
 * The founding plan catalogue.
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
    code: "STARTER",
    name: "Starter",
    description: "Everything a small Canadian business needs to keep a clean set of books.",
    forWhom: "A sole proprietor or small business doing their own books.",
    currency: "CAD",
    monthlyEquivalentCents: { MONTHLY: 1900, QUARTERLY: 1750, ANNUAL: 1583 },
    seats: 2,
    companies: 1,
    storageGb: 5,
    modules: ["ACCOUNTING"],
    support: "Email support",
    includes: [
      "Invoicing, sales quotes and expenses",
      "Bank import, rules and reconciliation",
      "GST/HST return working paper",
      "Balance sheet, P&L and cash flow",
    ],
    sortOrder: 10,
  },
  {
    code: "PROFESSIONAL",
    name: "Professional",
    description: "The full accounting product with approvals, budgets and role-based access.",
    forWhom: "A growing incorporated business with a bookkeeper.",
    currency: "CAD",
    monthlyEquivalentCents: { MONTHLY: 4900, QUARTERLY: 4500, ANNUAL: 4083 },
    seats: 5,
    companies: 2,
    storageGb: 25,
    modules: ["ACCOUNTING"],
    support: "Email and chat support",
    includes: [
      "Everything in Starter",
      "Bill approvals and period close",
      "Budgets and the full report pack",
      "Projects, recurring documents and credit notes",
      "Role-based access for your team",
    ],
    popular: true,
    sortOrder: 20,
  },
  {
    code: "BUSINESS",
    name: "Business",
    description: "Multi-entity accounting for an organisation running several companies.",
    forWhom: "A larger organisation running several entities.",
    currency: "CAD",
    monthlyEquivalentCents: { MONTHLY: 9900, QUARTERLY: 9100, ANNUAL: 8250 },
    seats: 15,
    companies: 10,
    storageGb: 100,
    modules: ["ACCOUNTING"],
    support: "Priority support",
    includes: [
      "Everything in Professional",
      "Up to 10 companies on one subscription",
      "Consolidated multi-entity switching",
      "Full audit trail and export",
      "Onboarding assistance",
    ],
    sortOrder: 30,
  },
  {
    code: "FIRM",
    name: "Firm",
    description: "A practice workspace across an entire portfolio of client files.",
    forWhom: "An accounting practice carrying a portfolio of client files.",
    currency: "CAD",
    monthlyEquivalentCents: { MONTHLY: 14900, QUARTERLY: 13700, ANNUAL: 12417 },
    seats: 25,
    companies: 50,
    storageGb: 250,
    modules: ["ACCOUNTING"],
    support: "Priority support and a named contact",
    includes: [
      "Everything in Business",
      "Firm workspace across every client",
      "Close checklist and review queue",
      "Client health dashboard",
      "Add clients without a second login",
    ],
    sortOrder: 40,
  },
];

/** The seed quotes a per-month rate; the amount actually billed follows from it. */
export function seedCycleAmountCents(plan: SeedPlan, cycle: BillingCycle): number {
  return plan.monthlyEquivalentCents[cycle] * CYCLE_MONTHS[cycle];
}
