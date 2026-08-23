import type { Capability } from "@/lib/permissions";
import { CAPABILITIES } from "@/lib/permissions";
import type { ModuleId } from "@/lib/plans";

export interface NavItem {
  label: string;
  href: string;
  capability?: Capability;
  badgeKey?: "bankQueue" | "overdue" | "approvals";
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  icon: string;
  items: NavItem[];
  /**
   * Which Red Leaf product this group belongs to. Absent means it is part of
   * the platform shell (dashboard, company settings) rather than a product.
   * Once organisation-level entitlements land, the sidebar filters on this.
   */
  module?: ModuleId;
}

/** Mirrors the §32 screen inventory. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Dashboard",
    icon: "gauge",
    items: [{ label: "Overview", href: "/dashboard", exact: true }],
  },
  {
    label: "Sales",
    module: "ACCOUNTING",
    icon: "receipt",
    items: [
      { label: "Invoices", href: "/sales/invoices", capability: CAPABILITIES.INVOICES, badgeKey: "overdue" },
      { label: "Customers", href: "/sales/customers", capability: CAPABILITIES.INVOICES },
      { label: "Sales quotes", href: "/sales/quotes", capability: CAPABILITIES.INVOICES },
      { label: "Credit notes", href: "/sales/credit-notes", capability: CAPABILITIES.INVOICES },
      { label: "Receipts", href: "/sales/receipts", capability: CAPABILITIES.PAYMENTS },
    ],
  },
  {
    label: "Purchases",
    module: "ACCOUNTING",
    icon: "truck",
    items: [
      { label: "Bills", href: "/purchases/bills", capability: CAPABILITIES.BILLS, badgeKey: "approvals" },
      { label: "Vendors", href: "/purchases/vendors", capability: CAPABILITIES.BILLS },
      { label: "Payments", href: "/purchases/payments", capability: CAPABILITIES.PAYMENTS },
    ],
  },
  {
    label: "Expenses",
    module: "ACCOUNTING",
    icon: "wallet",
    items: [{ label: "All expenses", href: "/expenses", capability: CAPABILITIES.EXPENSES, exact: true }],
  },
  {
    label: "Banking",
    module: "ACCOUNTING",
    icon: "bank",
    items: [
      { label: "Review queue", href: "/banking", capability: CAPABILITIES.BANKING, exact: true, badgeKey: "bankQueue" },
      { label: "Accounts", href: "/banking/accounts", capability: CAPABILITIES.BANKING },
      { label: "Rules", href: "/banking/rules", capability: CAPABILITIES.BANKING },
      { label: "Reconcile", href: "/banking/reconcile", capability: CAPABILITIES.BANKING },
    ],
  },
  {
    label: "Accounting",
    module: "ACCOUNTING",
    icon: "ledger",
    items: [
      { label: "Chart of accounts", href: "/accounting/chart-of-accounts", capability: CAPABILITIES.COA },
      { label: "Journal entries", href: "/accounting/journals", capability: CAPABILITIES.JOURNALS },
      { label: "Trial balance", href: "/accounting/trial-balance", capability: CAPABILITIES.REPORTS },
      { label: "General ledger", href: "/accounting/general-ledger", capability: CAPABILITIES.REPORTS },
      { label: "Fiscal periods", href: "/accounting/periods", capability: CAPABILITIES.REPORTS },
    ],
  },
  {
    label: "Tax Centre",
    module: "ACCOUNTING",
    icon: "leaf",
    items: [
      { label: "Overview", href: "/tax", capability: CAPABILITIES.TAX_FILING, exact: true },
      { label: "Tax codes", href: "/tax/codes", capability: CAPABILITIES.TAX_SETTINGS },
      { label: "Filing periods", href: "/tax/periods", capability: CAPABILITIES.TAX_FILING },
    ],
  },
  {
    label: "Reports",
    module: "ACCOUNTING",
    icon: "chart",
    items: [{ label: "All reports", href: "/reports", capability: CAPABILITIES.REPORTS, exact: true }],
  },
  {
    label: "HR",
    module: "HR",
    icon: "users",
    items: [
      { label: "Employees", href: "/hr/employees", capability: CAPABILITIES.HR, exact: true },
      { label: "Departments", href: "/hr/departments", capability: CAPABILITIES.HR },
      { label: "Time off", href: "/hr/time-off", capability: CAPABILITIES.HR },
      { label: "Leave types", href: "/hr/time-off/leave-types", capability: CAPABILITIES.HR },
    ],
  },
  {
    label: "Payroll",
    module: "PAYROLL",
    icon: "wallet",
    items: [{ label: "Pay runs", href: "/payroll/pay-runs", capability: CAPABILITIES.PAYROLL, exact: true }],
  },
  {
    label: "Company",
    icon: "building",
    items: [
      { label: "Profile & preferences", href: "/company", capability: CAPABILITIES.COMPANY_SETTINGS, exact: true },
      { label: "Companies", href: "/company/companies", capability: CAPABILITIES.COMPANY_SETTINGS },
      { label: "Products & services", href: "/company/products-services", capability: CAPABILITIES.COMPANY_SETTINGS },
      { label: "Users & access", href: "/company/users", capability: CAPABILITIES.USERS },
      { label: "Audit log", href: "/company/audit", capability: CAPABILITIES.AUDIT },
      { label: "Subscription", href: "/company/subscription", capability: CAPABILITIES.SUBSCRIPTION },
    ],
  },
];

export const ACCOUNTANT_GROUP: NavGroup = {
  label: "Firm workspace",
  icon: "briefcase",
  items: [
    { label: "Client dashboard", href: "/firm", exact: true },
    { label: "Review queue", href: "/firm/review" },
    { label: "Close checklist", href: "/firm/close" },
  ],
};
