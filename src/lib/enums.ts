/**
 * SQLite has no enum type, so every "enum" column is a String validated here
 * and at the Zod boundary. Moving the datasource to PostgreSQL later can
 * promote these to real enums without touching call sites.
 */

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Sign convention: which side increases the account. */
export const NORMAL_BALANCE: Record<AccountType, "DEBIT" | "CREDIT"> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  REVENUE: "CREDIT",
};

export const BALANCE_SHEET_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY"];
export const INCOME_STATEMENT_TYPES: AccountType[] = ["REVENUE", "EXPENSE"];

export const ACCOUNT_SUBTYPES: Record<AccountType, string[]> = {
  ASSET: [
    "BANK",
    "ACCOUNTS_RECEIVABLE",
    "OTHER_CURRENT_ASSET",
    "PREPAID_EXPENSE",
    "INVENTORY",
    "FIXED_ASSET",
    "ACCUMULATED_DEPRECIATION",
    "TAX_RECOVERABLE",
  ],
  LIABILITY: [
    "ACCOUNTS_PAYABLE",
    "CREDIT_CARD",
    "SALES_TAX_PAYABLE",
    "PAYROLL_LIABILITY",
    "OTHER_CURRENT_LIABILITY",
    "LONG_TERM_LIABILITY",
  ],
  EQUITY: ["SHARE_CAPITAL", "OWNER_EQUITY", "RETAINED_EARNINGS", "DRAWINGS"],
  REVENUE: ["OPERATING_REVENUE", "OTHER_INCOME"],
  EXPENSE: [
    "OPERATING_EXPENSE",
    "COST_OF_SALES",
    "PAYROLL_EXPENSE",
    "OTHER_EXPENSE",
    "DEPRECIATION",
    "AMORTIZATION",
    "INTEREST_EXPENSE",
    "INCOME_TAX_EXPENSE",
  ],
};

/** Human-readable subtype names for pickers and the chart of accounts. */
export const SUBTYPE_LABELS: Record<string, string> = {
  BANK: "Bank & cash",
  ACCOUNTS_RECEIVABLE: "Accounts receivable",
  OTHER_CURRENT_ASSET: "Other current asset",
  PREPAID_EXPENSE: "Prepaid expense",
  INVENTORY: "Inventory",
  FIXED_ASSET: "Fixed asset",
  ACCUMULATED_DEPRECIATION: "Accumulated depreciation",
  TAX_RECOVERABLE: "Tax recoverable",
  ACCOUNTS_PAYABLE: "Accounts payable",
  CREDIT_CARD: "Credit card",
  SALES_TAX_PAYABLE: "Sales tax payable",
  PAYROLL_LIABILITY: "Payroll liability",
  OTHER_CURRENT_LIABILITY: "Other current liability",
  LONG_TERM_LIABILITY: "Long-term liability",
  SHARE_CAPITAL: "Share capital",
  OWNER_EQUITY: "Owner equity",
  RETAINED_EARNINGS: "Retained earnings",
  DRAWINGS: "Drawings",
  OPERATING_REVENUE: "Operating revenue",
  OTHER_INCOME: "Other income",
  OPERATING_EXPENSE: "Operating expense",
  COST_OF_SALES: "Cost of sales",
  PAYROLL_EXPENSE: "Payroll expense",
  OTHER_EXPENSE: "Other expense",
  DEPRECIATION: "Depreciation",
  AMORTIZATION: "Amortization",
  INTEREST_EXPENSE: "Interest expense",
  INCOME_TAX_EXPENSE: "Income tax expense",
};

export function subtypeLabel(subtype: string): string {
  return SUBTYPE_LABELS[subtype] ?? subtype.replace(/_/g, " ").toLowerCase();
}

/**
 * How the Profit & Loss statement groups expenses, by SUBTYPE.
 *
 * Classification is by durable account subtype and never by account name or
 * code pattern. Matching "interest" or "6xxx" at report runtime looks
 * convenient and then silently misclassifies "Interest received", "Disinterest
 * survey costs" or any renamed account — and a P&L that changes shape because
 * someone edited a label is not a report anyone can rely on.
 *
 * EBITDA is earnings before interest, tax, depreciation and amortization, so
 * each of those four has to be separable from ordinary operating cost. That is
 * the whole reason the subtypes below exist.
 */
export const DEPRECIATION_AMORTIZATION_SUBTYPES = ["DEPRECIATION", "AMORTIZATION"] as const;
export const EBITDA_OPERATING_EXPENSE_SUBTYPES = ["OPERATING_EXPENSE", "PAYROLL_EXPENSE"] as const;
export const INTEREST_EXPENSE_SUBTYPES = ["INTEREST_EXPENSE"] as const;
export const INCOME_TAX_SUBTYPES = ["INCOME_TAX_EXPENSE"] as const;

/**
 * Control accounts the posting engine must be able to resolve by handle.
 * A company cannot delete these (Account.isSystem).
 */
export const SYSTEM_ACCOUNTS = {
  ACCOUNTS_RECEIVABLE: "ACCOUNTS_RECEIVABLE",
  ACCOUNTS_PAYABLE: "ACCOUNTS_PAYABLE",
  GST_HST_PAYABLE: "GST_HST_PAYABLE",
  GST_HST_RECOVERABLE: "GST_HST_RECOVERABLE",
  PST_PAYABLE: "PST_PAYABLE",
  QST_PAYABLE: "QST_PAYABLE",
  QST_RECOVERABLE: "QST_RECOVERABLE",
  RETAINED_EARNINGS: "RETAINED_EARNINGS",
  OPENING_BALANCE_EQUITY: "OPENING_BALANCE_EQUITY",
  UNCATEGORIZED_INCOME: "UNCATEGORIZED_INCOME",
  UNCATEGORIZED_EXPENSE: "UNCATEGORIZED_EXPENSE",
  BAD_DEBT_EXPENSE: "BAD_DEBT_EXPENSE",
  ROUNDING: "ROUNDING",
} as const;
export type SystemAccountKey = (typeof SYSTEM_ACCOUNTS)[keyof typeof SYSTEM_ACCOUNTS];

export const COMPANY_ROLES = ["PRIMARY", "SECONDARY", "REVIEWER", "ACCOUNTANT"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const ROLE_LABELS: Record<CompanyRole, string> = {
  PRIMARY: "Primary / Admin",
  SECONDARY: "Bookkeeper",
  REVIEWER: "Reviewer / Approver",
  ACCOUNTANT: "External Accountant",
};

export const INVOICE_STATUSES = [
  "DRAFT",
  "SENT",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const BILL_STATUSES = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
] as const;

export const JOURNAL_SOURCES = [
  "INVOICE",
  "BILL",
  "EXPENSE",
  "PAYMENT",
  "CREDIT_NOTE",
  "MANUAL",
  "BANK",
  "OPENING",
  "CLOSING",
  "ADJUSTMENT",
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const SOURCE_LABELS: Record<string, string> = {
  INVOICE: "Invoice",
  BILL: "Bill",
  EXPENSE: "Expense",
  PAYMENT: "Payment",
  CREDIT_NOTE: "Credit note",
  MANUAL: "Manual journal",
  BANK: "Banking",
  OPENING: "Opening balance",
  CLOSING: "Year-end close",
  ADJUSTMENT: "Adjustment",
};

export const TAX_KINDS = ["GST", "HST", "PST", "QST", "RST"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

export const PROVINCES = [
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NU", name: "Nunavut" },
  { code: "ON", name: "Ontario" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" },
  { code: "YT", name: "Yukon" },
] as const;

export const PERIOD_STATUSES = ["OPEN", "CLOSED", "LOCKED"] as const;
export const TAX_PERIOD_STATUSES = ["OPEN", "REVIEW", "FILED", "CLOSED"] as const;
