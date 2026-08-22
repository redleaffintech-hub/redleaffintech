/**
 * The Red Leaf plan catalogue — one source of truth.
 *
 * The marketing pricing page, the in-app subscription screen, the server-side
 * seat check in `src/app/(app)/company/actions.ts` and company provisioning all
 * read from here, so a price or a seat count can never disagree between what a
 * visitor is quoted and what the product actually enforces.
 *
 * Prices are integer cents of CAD, per the money convention in `./money.ts`.
 * They are quoted PER MONTH for every billing cycle so the three cycles are
 * directly comparable; `cyclePriceCents` gives the amount actually charged.
 *
 * Modules name the Red Leaf products a plan unlocks. Only ACCOUNTING ships
 * today — the rest are declared so the entitlement layer has something to read
 * once those products exist.
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
    blurb: "Employee records, time off, onboarding and documents in one place.",
    icon: "users",
    available: false,
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

export interface Plan {
  id: string;
  name: string;
  /** Who the plan is for — one line, shown on the pricing card. */
  forWhom: string;
  /** Per-month price in cents for each billing cycle. */
  monthlyEquivalentCents: Record<BillingCycle, number>;
  seats: number;
  companies: number;
  storageGb: number;
  modules: ModuleId[];
  support: string;
  includes: string[];
  popular?: boolean;
  /** Shown on the pricing page but not self-serve. */
  contactOnly?: boolean;
}

/**
 * Prices are placeholders pending the client's numbers. Quarterly is ~8% off
 * the monthly rate and annual ~17% (two months free), which is the shape the
 * pricing toggle is meant to demonstrate.
 */
export const PLANS: Plan[] = [
  {
    id: "STARTER",
    name: "Starter",
    forWhom: "A sole proprietor or small business doing their own books.",
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
  },
  {
    id: "PROFESSIONAL",
    name: "Professional",
    forWhom: "A growing incorporated business with a bookkeeper.",
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
  },
  {
    id: "BUSINESS",
    name: "Business",
    forWhom: "A larger organisation running several entities.",
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
  },
  {
    id: "FIRM",
    name: "Firm",
    forWhom: "An accounting practice carrying a portfolio of client files.",
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
  },
];

export const DEFAULT_PLAN_ID = "PROFESSIONAL";

export function planById(id: string): Plan | undefined {
  return PLANS.find((plan) => plan.id === id);
}

/** Seat allowance keyed by plan id — the server-side authority. */
export const PLAN_SEATS: Record<string, number> = Object.fromEntries(
  PLANS.map((plan) => [plan.id, plan.seats]),
);

/** What one invoice costs for a plan on a given cycle. */
export function cyclePriceCents(plan: Plan, cycle: BillingCycle): number {
  return plan.monthlyEquivalentCents[cycle] * CYCLE_MONTHS[cycle];
}

/** Whole-percent saving against paying monthly. 0 when there is none. */
export function cycleSavingPercent(plan: Plan, cycle: BillingCycle): number {
  const monthly = plan.monthlyEquivalentCents.MONTHLY;
  if (!monthly) return 0;
  const saving = 1 - plan.monthlyEquivalentCents[cycle] / monthly;
  return Math.round(saving * 100);
}

export function isValidCycle(value: string | null | undefined): value is BillingCycle {
  return !!value && (BILLING_CYCLES as readonly string[]).includes(value);
}
