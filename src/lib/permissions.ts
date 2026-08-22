/**
 * Permissions matrix (spec §34).
 *
 * Enforced server-side on every request (§3): "Every API request must enforce
 * tenant and permission checks server-side." The UI hides what a user cannot
 * do, but hiding is never the control — `requirePermission` is.
 */

import type { CompanyRole } from "./enums";

export const CAPABILITIES = {
  COMPANY_SETTINGS: "company.settings",
  USERS: "company.users",
  COA: "accounting.coa",
  INVOICES: "sales.invoices",
  BILLS: "purchases.bills",
  EXPENSES: "expenses",
  PAYMENTS: "payments",
  JOURNALS: "accounting.journals",
  PERIOD_CLOSE: "accounting.period_close",
  TAX_SETTINGS: "tax.settings",
  TAX_FILING: "tax.filing",
  BANKING: "banking",
  REPORTS: "reports",
  AUDIT: "audit",
  SUBSCRIPTION: "subscription",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/**
 * FULL   — create, edit, post, delete
 * REVIEW — read plus approve/reject, but cannot originate
 * VIEW   — read only
 * NONE   — not visible
 */
export type AccessLevel = "FULL" | "REVIEW" | "VIEW" | "NONE";

const MATRIX: Record<CompanyRole, Record<Capability, AccessLevel>> = {
  PRIMARY: {
    "company.settings": "FULL", "company.users": "FULL", "accounting.coa": "FULL",
    "sales.invoices": "FULL", "purchases.bills": "FULL", expenses: "FULL",
    payments: "FULL", "accounting.journals": "FULL", "accounting.period_close": "FULL",
    "tax.settings": "FULL", "tax.filing": "FULL", banking: "FULL",
    reports: "FULL", audit: "FULL", subscription: "FULL",
  },
  SECONDARY: {
    "company.settings": "VIEW", "company.users": "NONE", "accounting.coa": "VIEW",
    "sales.invoices": "FULL", "purchases.bills": "FULL", expenses: "FULL",
    payments: "FULL", "accounting.journals": "VIEW", "accounting.period_close": "NONE",
    "tax.settings": "VIEW", "tax.filing": "VIEW", banking: "FULL",
    reports: "FULL", audit: "VIEW", subscription: "NONE",
  },
  REVIEWER: {
    "company.settings": "VIEW", "company.users": "NONE", "accounting.coa": "VIEW",
    "sales.invoices": "REVIEW", "purchases.bills": "REVIEW", expenses: "REVIEW",
    payments: "REVIEW", "accounting.journals": "REVIEW", "accounting.period_close": "REVIEW",
    "tax.settings": "VIEW", "tax.filing": "VIEW", banking: "VIEW",
    reports: "FULL", audit: "VIEW", subscription: "NONE",
  },
  ACCOUNTANT: {
    "company.settings": "VIEW", "company.users": "NONE", "accounting.coa": "FULL",
    "sales.invoices": "FULL", "purchases.bills": "FULL", expenses: "FULL",
    payments: "FULL", "accounting.journals": "FULL", "accounting.period_close": "FULL",
    "tax.settings": "FULL", "tax.filing": "FULL", banking: "FULL",
    reports: "FULL", audit: "FULL", subscription: "NONE",
  },
};

export function accessLevel(role: CompanyRole, capability: Capability): AccessLevel {
  return MATRIX[role]?.[capability] ?? "NONE";
}

export function can(role: CompanyRole, capability: Capability): boolean {
  return accessLevel(role, capability) === "FULL";
}

export function canView(role: CompanyRole, capability: Capability): boolean {
  return accessLevel(role, capability) !== "NONE";
}

export function canApprove(role: CompanyRole, capability: Capability): boolean {
  const level = accessLevel(role, capability);
  return level === "FULL" || level === "REVIEW";
}

export class PermissionError extends Error {
  constructor(capability: Capability, role: CompanyRole) {
    super(`Your ${role.toLowerCase()} role does not allow "${capability}".`);
    this.name = "PermissionError";
  }
}

export function requirePermission(role: CompanyRole, capability: Capability) {
  if (!can(role, capability)) throw new PermissionError(capability, role);
}

export const MATRIX_FOR_DISPLAY = MATRIX;
