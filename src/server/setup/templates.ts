/**
 * Canadian service-business starter templates (spec §6, §7).
 *
 * PROFESSIONAL BOUNDARY (§40): these defaults are a starting point, not tax or
 * accounting advice. Rates are effective-dated and editable in Tax Centre, and
 * a Canadian CPA must validate the chart and the tax setup before the books are
 * used for filing.
 */

import { SYSTEM_ACCOUNTS as SA } from "@/lib/enums";

export interface AccountTemplate {
  code: string;
  name: string;
  type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  subtype: string;
  systemKey?: string;
  description?: string;
}

export const CANADIAN_SERVICE_COA: AccountTemplate[] = [
  // ── Assets ────────────────────────────────────────────────────────────────
  { code: "1000", name: "Business Chequing", type: "ASSET", subtype: "BANK" },
  { code: "1010", name: "Business Savings", type: "ASSET", subtype: "BANK" },
  { code: "1020", name: "Petty Cash", type: "ASSET", subtype: "BANK" },
  {
    code: "1100",
    name: "Accounts Receivable",
    type: "ASSET",
    subtype: "ACCOUNTS_RECEIVABLE",
    systemKey: SA.ACCOUNTS_RECEIVABLE,
    description: "Control account — posted to by invoices and receipts only.",
  },
  { code: "1150", name: "Undeposited Funds", type: "ASSET", subtype: "OTHER_CURRENT_ASSET" },
  { code: "1200", name: "Prepaid Expenses", type: "ASSET", subtype: "PREPAID_EXPENSE" },
  {
    code: "1300",
    name: "GST/HST Recoverable (ITC)",
    type: "ASSET",
    subtype: "TAX_RECOVERABLE",
    systemKey: SA.GST_HST_RECOVERABLE,
    description: "Input tax credits claimable on purchases.",
  },
  {
    code: "1310",
    name: "QST Recoverable (ITR)",
    type: "ASSET",
    subtype: "TAX_RECOVERABLE",
    systemKey: SA.QST_RECOVERABLE,
  },
  {
    code: "1450",
    name: "Inventory Asset",
    type: "ASSET",
    subtype: "INVENTORY",
    systemKey: SA.INVENTORY_ASSET,
    description: "Value of stock on hand, at weighted-average cost. Posted to by bills and invoices for tracked items only.",
  },
  { code: "1500", name: "Computer Equipment", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1510", name: "Office Furniture & Equipment", type: "ASSET", subtype: "FIXED_ASSET" },
  {
    code: "1590",
    name: "Accumulated Depreciation",
    type: "ASSET",
    subtype: "ACCUMULATED_DEPRECIATION",
  },

  // ── Liabilities ───────────────────────────────────────────────────────────
  {
    code: "2000",
    name: "Accounts Payable",
    type: "LIABILITY",
    subtype: "ACCOUNTS_PAYABLE",
    systemKey: SA.ACCOUNTS_PAYABLE,
    description: "Control account — posted to by bills and vendor payments only.",
  },
  { code: "2100", name: "Corporate Credit Card", type: "LIABILITY", subtype: "CREDIT_CARD" },
  {
    code: "2200",
    name: "GST/HST Payable",
    type: "LIABILITY",
    subtype: "SALES_TAX_PAYABLE",
    systemKey: SA.GST_HST_PAYABLE,
    description: "Sales tax collected on invoices, owing to CRA.",
  },
  {
    code: "2210",
    name: "PST/RST Payable",
    type: "LIABILITY",
    subtype: "SALES_TAX_PAYABLE",
    systemKey: SA.PST_PAYABLE,
  },
  {
    code: "2220",
    name: "QST Payable",
    type: "LIABILITY",
    subtype: "SALES_TAX_PAYABLE",
    systemKey: SA.QST_PAYABLE,
  },
  { code: "2300", name: "Payroll Liabilities", type: "LIABILITY", subtype: "PAYROLL_LIABILITY" },
  { code: "2400", name: "Deferred Revenue", type: "LIABILITY", subtype: "OTHER_CURRENT_LIABILITY" },
  { code: "2600", name: "Shareholder Loan", type: "LIABILITY", subtype: "LONG_TERM_LIABILITY" },

  // ── Equity ────────────────────────────────────────────────────────────────
  { code: "3000", name: "Common Shares", type: "EQUITY", subtype: "SHARE_CAPITAL" },
  { code: "3100", name: "Owner Contributions", type: "EQUITY", subtype: "OWNER_EQUITY" },
  { code: "3200", name: "Owner Drawings", type: "EQUITY", subtype: "DRAWINGS" },
  {
    code: "3300",
    name: "Retained Earnings",
    type: "EQUITY",
    subtype: "RETAINED_EARNINGS",
    systemKey: SA.RETAINED_EARNINGS,
    description: "Accumulated prior-year earnings. Written by the year-end close.",
  },
  {
    code: "3900",
    name: "Opening Balance Equity",
    type: "EQUITY",
    subtype: "OWNER_EQUITY",
    systemKey: SA.OPENING_BALANCE_EQUITY,
    description: "Temporary holding account for migrated opening balances.",
  },

  // ── Revenue ───────────────────────────────────────────────────────────────
  { code: "4000", name: "Consulting Revenue", type: "REVENUE", subtype: "OPERATING_REVENUE" },
  { code: "4010", name: "Professional Services Revenue", type: "REVENUE", subtype: "OPERATING_REVENUE" },
  { code: "4020", name: "Retainer & Support Revenue", type: "REVENUE", subtype: "OPERATING_REVENUE" },
  { code: "4100", name: "Reimbursed Expense Income", type: "REVENUE", subtype: "OPERATING_REVENUE" },
  { code: "4900", name: "Other Income", type: "REVENUE", subtype: "OTHER_INCOME" },
  {
    code: "4990",
    name: "Uncategorized Income",
    type: "REVENUE",
    subtype: "OPERATING_REVENUE",
    systemKey: SA.UNCATEGORIZED_INCOME,
  },

  {
    code: "4910",
    name: "Interest Income",
    type: "REVENUE",
    subtype: "INTEREST_INCOME",
    description: "Interest earned on balances. Non-operating — sits below EBIT, not in net sales.",
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  { code: "5000", name: "Subcontractor Costs", type: "EXPENSE", subtype: "COST_OF_SALES" },
  { code: "5010", name: "Direct Project Costs", type: "EXPENSE", subtype: "COST_OF_SALES" },
  {
    code: "5900",
    name: "Cost of Goods Sold",
    type: "EXPENSE",
    subtype: "COST_OF_SALES",
    systemKey: SA.COST_OF_GOODS_SOLD,
    description: "Weighted-average cost of tracked inventory items as they sell.",
  },
  { code: "6000", name: "Advertising & Promotion", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  {
    code: "6010",
    name: "Bank Charges",
    type: "EXPENSE",
    subtype: "OPERATING_EXPENSE",
    description: "Account and transaction fees. Financing interest belongs in 6015, below EBITDA.",
  },
  {
    code: "6015",
    name: "Interest Expense",
    type: "EXPENSE",
    subtype: "INTEREST_EXPENSE",
    description: "Interest on loans and credit facilities. Excluded from EBITDA by definition.",
  },
  { code: "6020", name: "Business Licences & Fees", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6030", name: "Software & Subscriptions", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6040", name: "Insurance", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6050", name: "Meals & Entertainment", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6060", name: "Office Supplies", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6070", name: "Professional Fees", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6080", name: "Rent", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6090", name: "Repairs & Maintenance", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6100", name: "Salaries & Wages", type: "EXPENSE", subtype: "PAYROLL_EXPENSE" },
  { code: "6110", name: "Employee Benefits", type: "EXPENSE", subtype: "PAYROLL_EXPENSE" },
  { code: "6120", name: "Telephone & Internet", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6130", name: "Travel", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6140", name: "Vehicle & Mileage", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6150", name: "Training & Development", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6160", name: "Utilities", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6200", name: "Depreciation Expense", type: "EXPENSE", subtype: "DEPRECIATION" },
  {
    code: "6210",
    name: "Amortization Expense",
    type: "EXPENSE",
    subtype: "AMORTIZATION",
    description: "Write-down of intangible assets. Excluded from EBITDA alongside depreciation.",
  },
  {
    code: "6800",
    name: "Bad Debt Expense",
    type: "EXPENSE",
    subtype: "OPERATING_EXPENSE",
    systemKey: SA.BAD_DEBT_EXPENSE,
  },
  {
    code: "6850",
    name: "Income Tax Expense",
    type: "EXPENSE",
    subtype: "INCOME_TAX_EXPENSE",
    description: "Corporate income tax. The last line of the P&L, below income before tax.",
  },
  {
    code: "6900",
    name: "Rounding Differences",
    type: "EXPENSE",
    subtype: "OTHER_EXPENSE",
    systemKey: SA.ROUNDING,
  },
  {
    code: "6990",
    name: "Uncategorized Expense",
    type: "EXPENSE",
    subtype: "OPERATING_EXPENSE",
    systemKey: SA.UNCATEGORIZED_EXPENSE,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tax code templates
// ─────────────────────────────────────────────────────────────────────────────

export interface TaxComponentTemplate {
  name: string;
  kind: "GST" | "HST" | "PST" | "QST" | "RST";
  /** rate * 1_000_000 */
  rateMicro: number;
  isRecoverable: boolean;
  compoundOnPrevious?: boolean;
  liabilityKey?: string;
  recoverableKey?: string;
}

export interface TaxCodeTemplate {
  code: string;
  name: string;
  description?: string;
  jurisdiction: string;
  isZeroRated?: boolean;
  isExempt?: boolean;
  appliesToSales?: boolean;
  appliesToPurchases?: boolean;
  effectiveFrom: string;
  components: TaxComponentTemplate[];
}

const GST5: TaxComponentTemplate = {
  name: "GST",
  kind: "GST",
  rateMicro: 50_000,
  isRecoverable: true,
  liabilityKey: SA.GST_HST_PAYABLE,
  recoverableKey: SA.GST_HST_RECOVERABLE,
};

function hst(rateMicro: number): TaxComponentTemplate {
  return {
    name: "HST",
    kind: "HST",
    rateMicro,
    isRecoverable: true,
    liabilityKey: SA.GST_HST_PAYABLE,
    recoverableKey: SA.GST_HST_RECOVERABLE,
  };
}

/** Provincial sales tax is generally NOT recoverable by the purchaser. */
function pst(kind: "PST" | "RST", rateMicro: number): TaxComponentTemplate {
  return {
    name: kind,
    kind,
    rateMicro,
    isRecoverable: false,
    liabilityKey: SA.PST_PAYABLE,
  };
}

const QST: TaxComponentTemplate = {
  name: "QST",
  kind: "QST",
  rateMicro: 99_750, // 9.975%
  isRecoverable: true,
  compoundOnPrevious: false, // QST has been levied on the pre-GST amount since 2013
  liabilityKey: SA.QST_PAYABLE,
  recoverableKey: SA.QST_RECOVERABLE,
};

/**
 * Rates as commonly published for each jurisdiction. Effective-dated so a
 * future change is added as a new code rather than editing history (§7).
 */
export const PROVINCIAL_TAX_CODES: Record<string, TaxCodeTemplate[]> = {
  ON: [{ code: "HST-ON", name: "HST 13% (Ontario)", jurisdiction: "ON", effectiveFrom: "2010-07-01", components: [hst(130_000)] }],
  NB: [{ code: "HST-NB", name: "HST 15% (New Brunswick)", jurisdiction: "NB", effectiveFrom: "2016-07-01", components: [hst(150_000)] }],
  NL: [{ code: "HST-NL", name: "HST 15% (Newfoundland & Labrador)", jurisdiction: "NL", effectiveFrom: "2016-07-01", components: [hst(150_000)] }],
  PE: [{ code: "HST-PE", name: "HST 15% (Prince Edward Island)", jurisdiction: "PE", effectiveFrom: "2016-10-01", components: [hst(150_000)] }],
  NS: [{ code: "HST-NS", name: "HST 14% (Nova Scotia)", jurisdiction: "NS", effectiveFrom: "2025-04-01", components: [hst(140_000)] }],
  BC: [{ code: "GST-PST-BC", name: "GST 5% + PST 7% (British Columbia)", jurisdiction: "BC", effectiveFrom: "2013-04-01", components: [GST5, pst("PST", 70_000)] }],
  SK: [{ code: "GST-PST-SK", name: "GST 5% + PST 6% (Saskatchewan)", jurisdiction: "SK", effectiveFrom: "2017-03-23", components: [GST5, pst("PST", 60_000)] }],
  MB: [{ code: "GST-RST-MB", name: "GST 5% + RST 7% (Manitoba)", jurisdiction: "MB", effectiveFrom: "2019-07-01", components: [GST5, pst("RST", 70_000)] }],
  QC: [{ code: "GST-QST-QC", name: "GST 5% + QST 9.975% (Quebec)", jurisdiction: "QC", effectiveFrom: "2013-01-01", components: [GST5, QST] }],
  AB: [], NT: [], NU: [], YT: [],
};

/** Codes every Canadian company gets regardless of province. */
export const BASE_TAX_CODES: TaxCodeTemplate[] = [
  {
    code: "GST",
    name: "GST 5%",
    description: "Federal GST only — AB, NT, NU, YT and interprovincial supplies.",
    jurisdiction: "CA",
    effectiveFrom: "2008-01-01",
    components: [GST5],
  },
  {
    code: "ZERO",
    name: "Zero-rated 0%",
    description: "Taxable at 0% — exports, basic groceries, certain medical devices. ITCs still claimable.",
    jurisdiction: "CA",
    isZeroRated: true,
    effectiveFrom: "2008-01-01",
    components: [],
  },
  {
    code: "EXEMPT",
    name: "Exempt",
    description: "Exempt supplies — no tax charged and no ITC on related inputs.",
    jurisdiction: "CA",
    isExempt: true,
    effectiveFrom: "2008-01-01",
    components: [],
  },
  {
    code: "OUT",
    name: "Out of scope",
    description: "Transfers, owner draws and other non-taxable movements.",
    jurisdiction: "CA",
    isExempt: true,
    effectiveFrom: "2008-01-01",
    components: [],
  },
];

export function taxCodesForProvince(province: string): TaxCodeTemplate[] {
  const provincial = PROVINCIAL_TAX_CODES[province] ?? [];
  return [...provincial, ...BASE_TAX_CODES];
}

/**
 * The provinces that levy a sales tax of their own, so a published code exists
 * for them. AB, NT, NU and YT are absent by design: only federal GST applies
 * there, which is the code every company already has.
 */
export const PROVINCES_WITH_SALES_TAX: readonly string[] = Object.entries(PROVINCIAL_TAX_CODES)
  .filter(([, templates]) => templates.length > 0)
  .map(([province]) => province);
