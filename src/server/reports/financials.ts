/**
 * Financial statements (spec §12).
 *
 * CRITICAL RULE (§12): every figure below is aggregated from `journal_lines`.
 * Nothing reads an invoice, a bill or any UI state. That is what makes every
 * total drill down to the transactions that produced it, and what keeps the
 * subledgers reconciled to their control accounts.
 */

import { db } from "@/lib/db";
import {
  DEPRECIATION_AMORTIZATION_SUBTYPES,
  EBITDA_OPERATING_EXPENSE_SUBTYPES,
  INCOME_TAX_SUBTYPES,
  INTEREST_EXPENSE_SUBTYPES,
  NORMAL_BALANCE,
  type AccountType,
} from "@/lib/enums";
import { fiscalYearRange, fiscalYearOf, monthsBetween, endOfMonth } from "@/lib/dates";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  debitCents: number;
  creditCents: number;
  /** Positive in the account's natural direction. */
  balanceCents: number;
}

async function balancesFor(companyId: string, where: object): Promise<AccountBalance[]> {
  const [grouped, accounts] = await Promise.all([
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { companyId, ...where },
      _sum: { debitCents: true, creditCents: true },
    }),
    db.account.findMany({
      where: { companyId },
      select: { id: true, code: true, name: true, type: true, subtype: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const sums = new Map(grouped.map((g) => [g.accountId, g._sum]));
  return accounts.map((a) => {
    const s = sums.get(a.id);
    const debitCents = s?.debitCents ?? 0;
    const creditCents = s?.creditCents ?? 0;
    return {
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type as AccountType,
      subtype: a.subtype,
      debitCents,
      creditCents,
      balanceCents:
        NORMAL_BALANCE[a.type as AccountType] === "DEBIT"
          ? debitCents - creditCents
          : creditCents - debitCents,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Trial balance
// ─────────────────────────────────────────────────────────────────────────────

export interface TrialBalanceRow extends AccountBalance {
  openingCents: number;
  periodDebitCents: number;
  periodCreditCents: number;
  closingCents: number;
}

export async function trialBalance(companyId: string, range: DateRange) {
  const [opening, period] = await Promise.all([
    balancesFor(companyId, { date: { lt: range.from } }),
    balancesFor(companyId, { date: { gte: range.from, lte: range.to } }),
  ]);
  const openingById = new Map(opening.map((o) => [o.accountId, o]));

  const rows: TrialBalanceRow[] = period
    .map((p) => {
      const open = openingById.get(p.accountId);
      const openingCents = open?.balanceCents ?? 0;
      return {
        ...p,
        openingCents,
        periodDebitCents: p.debitCents,
        periodCreditCents: p.creditCents,
        closingCents: openingCents + p.balanceCents,
      };
    })
    .filter((r) => r.openingCents !== 0 || r.periodDebitCents !== 0 || r.periodCreditCents !== 0);

  const totalDebitCents = rows.reduce((s, r) => s + r.periodDebitCents, 0);
  const totalCreditCents = rows.reduce((s, r) => s + r.periodCreditCents, 0);

  // Closing figures restated as debit/credit columns for presentation.
  const closingDebitCents = rows.reduce(
    (s, r) => s + (NORMAL_BALANCE[r.type] === "DEBIT" ? Math.max(r.closingCents, 0) : Math.max(-r.closingCents, 0)),
    0,
  );
  const closingCreditCents = rows.reduce(
    (s, r) => s + (NORMAL_BALANCE[r.type] === "CREDIT" ? Math.max(r.closingCents, 0) : Math.max(-r.closingCents, 0)),
    0,
  );

  return {
    rows,
    totalDebitCents,
    totalCreditCents,
    closingDebitCents,
    closingCreditCents,
    balanced: totalDebitCents === totalCreditCents && closingDebitCents === closingCreditCents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Profit & Loss
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The statement in presentation order, built so EBITDA is a visible subtotal
 * rather than something the reader has to reconstruct.
 *
 * Depreciation and amortization are pulled OUT of operating expenses, and
 * interest and income tax get their own sections, because EBITDA is by
 * definition earnings before exactly those four. Every membership decision is
 * by durable subtype (src/lib/enums.ts) — never by account name or code range.
 */
const PL_SECTIONS = [
  { key: "REVENUE", label: "Revenue", subtypes: ["OPERATING_REVENUE"] },
  { key: "COST_OF_SALES", label: "Cost of sales", subtypes: ["COST_OF_SALES"] },
  {
    key: "OPERATING_EXPENSE",
    label: "Operating expenses",
    subtypes: [...EBITDA_OPERATING_EXPENSE_SUBTYPES],
  },
  {
    key: "DEPRECIATION_AMORTIZATION",
    label: "Depreciation & amortization",
    subtypes: [...DEPRECIATION_AMORTIZATION_SUBTYPES],
  },
  { key: "OTHER_INCOME", label: "Other income", subtypes: ["OTHER_INCOME"] },
  { key: "OTHER_EXPENSE", label: "Other expenses", subtypes: ["OTHER_EXPENSE"] },
  { key: "INTEREST_EXPENSE", label: "Interest expense", subtypes: [...INTEREST_EXPENSE_SUBTYPES] },
  { key: "INCOME_TAX_EXPENSE", label: "Income tax expense", subtypes: [...INCOME_TAX_SUBTYPES] },
] as const;

export interface ComparedAccountBalance extends AccountBalance {
  comparisonCents?: number;
}

export interface StatementSection {
  key: string;
  label: string;
  rows: ComparedAccountBalance[];
  totalCents: number;
  comparisonTotalCents?: number;
}

export async function profitAndLoss(
  companyId: string,
  range: DateRange,
  comparison?: DateRange,
) {
  const [current, prior] = await Promise.all([
    balancesFor(companyId, { date: { gte: range.from, lte: range.to }, accountType: { in: ["REVENUE", "EXPENSE"] } }),
    comparison
      ? balancesFor(companyId, { date: { gte: comparison.from, lte: comparison.to }, accountType: { in: ["REVENUE", "EXPENSE"] } })
      : Promise.resolve([] as AccountBalance[]),
  ]);

  const priorById = new Map(prior.map((p) => [p.accountId, p.balanceCents]));
  const sections: StatementSection[] = [];

  for (const section of PL_SECTIONS) {
    const rows = current
      .filter((a) => section.subtypes.includes(a.subtype as never))
      .map((a) => ({ ...a, comparisonCents: priorById.get(a.accountId) ?? 0 }))
      .filter((a) => a.balanceCents !== 0 || (a.comparisonCents ?? 0) !== 0);
    sections.push({
      key: section.key,
      label: section.label,
      rows,
      totalCents: rows.reduce((s, r) => s + r.balanceCents, 0),
      comparisonTotalCents: rows.reduce((s, r) => s + (r.comparisonCents ?? 0), 0),
    });
  }

  const find = (key: string) => sections.find((s) => s.key === key)!;
  const now = (key: string) => find(key).totalCents;
  const was = (key: string) => find(key).comparisonTotalCents ?? 0;

  /**
   * Both periods run through the same ladder, so a comparison column can never
   * drift from the figure it is compared against.
   *
   * Net income is deliberately the same arithmetic as before this report was
   * restructured. Depreciation simply moved out of `OPERATING_EXPENSE` into its
   * own section, and interest and tax are new sections that are empty for any
   * company that has not classified an account into them — so every existing
   * file reports exactly the net income it did before, and continues to tie to
   * the balance sheet and the cash flow statement.
   */
  const ladder = (total: (key: string) => number) => {
    const revenue = total("REVENUE");
    const costOfSales = total("COST_OF_SALES");
    const operatingExpenses = total("OPERATING_EXPENSE");
    const depreciationAmortization = total("DEPRECIATION_AMORTIZATION");
    const otherIncome = total("OTHER_INCOME");
    const otherExpense = total("OTHER_EXPENSE");
    const interest = total("INTEREST_EXPENSE");
    const incomeTax = total("INCOME_TAX_EXPENSE");

    const grossProfit = revenue - costOfSales;
    const ebitda = grossProfit - operatingExpenses;
    const ebit = ebitda - depreciationAmortization;
    const incomeBeforeTax = ebit + otherIncome - otherExpense - interest;

    return {
      revenue,
      costOfSales,
      operatingExpenses,
      depreciationAmortization,
      otherIncome,
      otherExpense,
      interest,
      incomeTax,
      grossProfit,
      ebitda,
      ebit,
      incomeBeforeTax,
      netIncome: incomeBeforeTax - incomeTax,
      totalExpense: costOfSales + operatingExpenses + depreciationAmortization + otherExpense + interest + incomeTax,
    };
  };

  const current_ = ladder(now);
  const prior_ = ladder(was);

  /** EBITDA / revenue. Null rather than 0 when there is no revenue to divide by. */
  const margin = (numerator: number, revenue: number) =>
    revenue > 0 ? (numerator / revenue) * 100 : null;

  return {
    range,
    comparison,
    sections,

    // Subtotals, each with its prior-period counterpart.
    grossProfitCents: current_.grossProfit,
    comparisonGrossProfitCents: prior_.grossProfit,
    ebitdaCents: current_.ebitda,
    comparisonEbitdaCents: prior_.ebitda,
    ebitCents: current_.ebit,
    comparisonEbitCents: prior_.ebit,
    incomeBeforeTaxCents: current_.incomeBeforeTax,
    comparisonIncomeBeforeTaxCents: prior_.incomeBeforeTax,
    netIncomeCents: current_.netIncome,
    comparisonNetIncomeCents: prior_.netIncome,

    /** EBIT. Kept under its previous name for callers that read operating income. */
    operatingIncomeCents: current_.ebit,

    revenueCents: current_.revenue,
    comparisonRevenueCents: prior_.revenue,
    totalExpenseCents: current_.totalExpense,

    // Margins, null when revenue is zero so callers cannot divide by it.
    grossMarginPercent: margin(current_.grossProfit, current_.revenue),
    ebitdaMarginPercent: margin(current_.ebitda, current_.revenue),
    netMarginPercent: margin(current_.netIncome, current_.revenue),
  };
}

/** Month-by-month revenue / expense / net income for trend charts and columns. */
export async function monthlyPerformance(companyId: string, range: DateRange) {
  const lines = await db.journalLine.groupBy({
    by: ["accountType", "date"],
    where: { companyId, date: { gte: range.from, lte: range.to }, accountType: { in: ["REVENUE", "EXPENSE"] } },
    _sum: { debitCents: true, creditCents: true },
  });

  const buckets = new Map<string, { month: Date; revenueCents: number; expenseCents: number }>();
  for (const month of monthsBetween(range.from, range.to)) {
    buckets.set(month.toISOString(), { month, revenueCents: 0, expenseCents: 0 });
  }

  for (const line of lines) {
    const month = new Date(Date.UTC(line.date.getUTCFullYear(), line.date.getUTCMonth(), 1));
    const bucket = buckets.get(month.toISOString());
    if (!bucket) continue;
    const value = NORMAL_BALANCE[line.accountType as AccountType] === "CREDIT"
      ? (line._sum.creditCents ?? 0) - (line._sum.debitCents ?? 0)
      : (line._sum.debitCents ?? 0) - (line._sum.creditCents ?? 0);
    if (line.accountType === "REVENUE") bucket.revenueCents += value;
    else bucket.expenseCents += value;
  }

  return [...buckets.values()].map((b) => ({ ...b, netIncomeCents: b.revenueCents - b.expenseCents }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance Sheet
// ─────────────────────────────────────────────────────────────────────────────

const BS_SECTIONS = [
  { key: "CURRENT_ASSETS", label: "Current assets", type: "ASSET", subtypes: ["BANK", "ACCOUNTS_RECEIVABLE", "OTHER_CURRENT_ASSET", "PREPAID_EXPENSE", "INVENTORY", "TAX_RECOVERABLE"] },
  { key: "FIXED_ASSETS", label: "Property & equipment", type: "ASSET", subtypes: ["FIXED_ASSET", "ACCUMULATED_DEPRECIATION"] },
  { key: "CURRENT_LIABILITIES", label: "Current liabilities", type: "LIABILITY", subtypes: ["ACCOUNTS_PAYABLE", "CREDIT_CARD", "SALES_TAX_PAYABLE", "PAYROLL_LIABILITY", "OTHER_CURRENT_LIABILITY"] },
  { key: "LONG_TERM_LIABILITIES", label: "Long-term liabilities", type: "LIABILITY", subtypes: ["LONG_TERM_LIABILITY"] },
  { key: "EQUITY", label: "Equity", type: "EQUITY", subtypes: ["SHARE_CAPITAL", "OWNER_EQUITY", "RETAINED_EARNINGS", "DRAWINGS"] },
] as const;

export async function balanceSheet(companyId: string, asOf: Date, comparisonDate?: Date) {
  const [current, prior] = await Promise.all([
    balancesFor(companyId, { date: { lte: asOf } }),
    comparisonDate ? balancesFor(companyId, { date: { lte: comparisonDate } }) : Promise.resolve([] as AccountBalance[]),
  ]);
  const priorById = new Map(prior.map((p) => [p.accountId, p.balanceCents]));

  const sections = BS_SECTIONS.map((section) => {
    const rows = current
      .filter((a) => a.type === section.type && section.subtypes.includes(a.subtype as never))
      .map((a) => ({ ...a, comparisonCents: priorById.get(a.accountId) ?? 0 }))
      .filter((a) => a.balanceCents !== 0 || (a.comparisonCents ?? 0) !== 0);
    return {
      key: section.key,
      label: section.label,
      rows,
      totalCents: rows.reduce((s, r) => s + r.balanceCents, 0),
      comparisonTotalCents: rows.reduce((s, r) => s + (r.comparisonCents ?? 0), 0),
    };
  });

  /**
   * Earnings not yet swept into Retained Earnings by a year-end close. Because
   * closing entries zero the P&L accounts, the all-time revenue-less-expense
   * balance IS the unclosed amount — no fiscal-year arithmetic needed, and it
   * makes the equation tie for companies mid-year or never closed.
   */
  const currentEarningsCents =
    current.filter((a) => a.type === "REVENUE").reduce((s, a) => s + a.balanceCents, 0) -
    current.filter((a) => a.type === "EXPENSE").reduce((s, a) => s + a.balanceCents, 0);
  const priorEarningsCents =
    prior.filter((a) => a.type === "REVENUE").reduce((s, a) => s + a.balanceCents, 0) -
    prior.filter((a) => a.type === "EXPENSE").reduce((s, a) => s + a.balanceCents, 0);

  const find = (key: string) => sections.find((s) => s.key === key)!;
  const totalAssetsCents = find("CURRENT_ASSETS").totalCents + find("FIXED_ASSETS").totalCents;
  const totalLiabilitiesCents = find("CURRENT_LIABILITIES").totalCents + find("LONG_TERM_LIABILITIES").totalCents;
  const totalEquityCents = find("EQUITY").totalCents + currentEarningsCents;

  return {
    asOf,
    comparisonDate,
    sections,
    currentEarningsCents,
    priorEarningsCents,
    totalAssetsCents,
    totalLiabilitiesCents,
    totalEquityCents,
    totalLiabilitiesAndEquityCents: totalLiabilitiesCents + totalEquityCents,
    /** Must be zero. Anything else is a ledger integrity exception (§5.3). */
    outOfBalanceCents: totalAssetsCents - (totalLiabilitiesCents + totalEquityCents),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// General Ledger
// ─────────────────────────────────────────────────────────────────────────────

export async function generalLedger(
  companyId: string,
  range: DateRange,
  options: { accountIds?: string[]; sourceType?: string; limit?: number } = {},
) {
  const accounts = await db.account.findMany({
    where: { companyId, ...(options.accountIds?.length ? { id: { in: options.accountIds } } : {}) },
    orderBy: { code: "asc" },
  });

  const opening = await db.journalLine.groupBy({
    by: ["accountId"],
    where: { companyId, date: { lt: range.from }, ...(options.accountIds?.length ? { accountId: { in: options.accountIds } } : {}) },
    _sum: { debitCents: true, creditCents: true },
  });
  const openingById = new Map(
    opening.map((o) => [o.accountId, (o._sum.debitCents ?? 0) - (o._sum.creditCents ?? 0)]),
  );

  const lines = await db.journalLine.findMany({
    where: {
      companyId,
      date: { gte: range.from, lte: range.to },
      ...(options.accountIds?.length ? { accountId: { in: options.accountIds } } : {}),
      ...(options.sourceType ? { journalEntry: { sourceType: options.sourceType } } : {}),
    },
    include: {
      journalEntry: { select: { entryNo: true, sourceType: true, sourceNumber: true, memo: true, status: true } },
      customer: { select: { name: true } },
      vendor: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }, { journalEntryId: "asc" }, { lineNo: "asc" }],
    take: options.limit ?? 5000,
  });

  const byAccount = new Map<string, typeof lines>();
  for (const line of lines) {
    const list = byAccount.get(line.accountId) ?? [];
    list.push(line);
    byAccount.set(line.accountId, list);
  }

  return accounts
    .map((account) => {
      const accountLines = byAccount.get(account.id) ?? [];
      const isDebitNatural = NORMAL_BALANCE[account.type as AccountType] === "DEBIT";
      const openingSigned = openingById.get(account.id) ?? 0;
      let running = openingSigned;
      const rows = accountLines.map((line) => {
        running += line.debitCents - line.creditCents;
        return { ...line, runningBalanceCents: isDebitNatural ? running : -running };
      });
      return {
        account,
        openingBalanceCents: isDebitNatural ? openingSigned : -openingSigned,
        rows,
        totalDebitCents: rows.reduce((s, r) => s + r.debitCents, 0),
        totalCreditCents: rows.reduce((s, r) => s + r.creditCents, 0),
        closingBalanceCents: isDebitNatural ? running : -running,
      };
    })
    .filter((g) => g.rows.length > 0 || g.openingBalanceCents !== 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cash Flow (indirect)
// ─────────────────────────────────────────────────────────────────────────────

const CASH_FLOW_CLASS: Record<string, "OPERATING" | "INVESTING" | "FINANCING"> = {
  ACCOUNTS_RECEIVABLE: "OPERATING",
  OTHER_CURRENT_ASSET: "OPERATING",
  PREPAID_EXPENSE: "OPERATING",
  TAX_RECOVERABLE: "OPERATING",
  INVENTORY: "OPERATING",
  // Accumulated depreciation sits in operating so the depreciation expense in
  // net income is added back rather than showing up as an investing inflow.
  ACCUMULATED_DEPRECIATION: "OPERATING",
  ACCOUNTS_PAYABLE: "OPERATING",
  CREDIT_CARD: "OPERATING",
  SALES_TAX_PAYABLE: "OPERATING",
  PAYROLL_LIABILITY: "OPERATING",
  OTHER_CURRENT_LIABILITY: "OPERATING",
  FIXED_ASSET: "INVESTING",
  LONG_TERM_LIABILITY: "FINANCING",
  SHARE_CAPITAL: "FINANCING",
  OWNER_EQUITY: "FINANCING",
  RETAINED_EARNINGS: "FINANCING",
  DRAWINGS: "FINANCING",
};

/**
 * Built mechanically: for every non-cash account, the negative of its net debit
 * movement is a cash effect. Summing all of them necessarily equals the actual
 * movement in the bank accounts, so this statement always ties to cash.
 */
export async function cashFlow(companyId: string, range: DateRange) {
  const movements = await balancesFor(companyId, { date: { gte: range.from, lte: range.to } });
  const openingCash = await balancesFor(companyId, { date: { lt: range.from } });

  const sections: Record<"OPERATING" | "INVESTING" | "FINANCING", { name: string; code: string; amountCents: number }[]> = {
    OPERATING: [], INVESTING: [], FINANCING: [],
  };

  let netIncomeCents = 0;
  for (const account of movements) {
    const netDebit = account.debitCents - account.creditCents;
    if (account.subtype === "BANK") continue;

    if (account.type === "REVENUE" || account.type === "EXPENSE") {
      netIncomeCents += account.type === "REVENUE" ? -netDebit : -netDebit;
      continue;
    }
    if (netDebit === 0) continue;
    const bucket = CASH_FLOW_CLASS[account.subtype] ?? "OPERATING";
    sections[bucket].push({ name: account.name, code: account.code, amountCents: -netDebit });
  }

  const operatingItems = sections.OPERATING;
  const operatingCents = netIncomeCents + operatingItems.reduce((s, i) => s + i.amountCents, 0);
  const investingCents = sections.INVESTING.reduce((s, i) => s + i.amountCents, 0);
  const financingCents = sections.FINANCING.reduce((s, i) => s + i.amountCents, 0);

  const cashOpeningCents = openingCash.filter((a) => a.subtype === "BANK").reduce((s, a) => s + a.balanceCents, 0);
  const cashMovementCents = movements.filter((a) => a.subtype === "BANK").reduce((s, a) => s + a.balanceCents, 0);

  return {
    range,
    netIncomeCents,
    operatingItems,
    operatingCents,
    investingItems: sections.INVESTING,
    investingCents,
    financingItems: sections.FINANCING,
    financingCents,
    netChangeCents: operatingCents + investingCents + financingCents,
    cashOpeningCents,
    cashClosingCents: cashOpeningCents + cashMovementCents,
    /** Sanity check — should be zero. */
    tieOutCents: operatingCents + investingCents + financingCents - cashMovementCents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function currentFiscalRange(companyId: string, asOf = new Date()): Promise<DateRange> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { fiscalYearStartMonth: true },
  });
  const year = fiscalYearOf(asOf, company.fiscalYearStartMonth);
  const { start, end } = fiscalYearRange(year, company.fiscalYearStartMonth);
  return { from: start, to: end < asOf ? end : endOfMonth(asOf) };
}

export async function accountBalance(companyId: string, accountId: string, asOf: Date) {
  const result = await db.journalLine.aggregate({
    where: { companyId, accountId, date: { lte: asOf } },
    _sum: { debitCents: true, creditCents: true },
  });
  return (result._sum.debitCents ?? 0) - (result._sum.creditCents ?? 0);
}
