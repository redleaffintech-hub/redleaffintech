/**
 * Financial statements (spec §12).
 *
 * CRITICAL RULE (§12): every figure below is aggregated from `journal_lines`.
 * Nothing reads an invoice, a bill or any UI state. That is what makes every
 * total drill down to the transactions that produced it, and what keeps the
 * subledgers reconciled to their control accounts.
 */

import { db } from "@/lib/db";
import { INCOME_STATEMENT_SUBTYPES, NORMAL_BALANCE, type AccountType } from "@/lib/enums";
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
 * The income statement, in presentation order.
 *
 *   net sales - material expenses = gross profit
 *   gross profit - SG&A           = EBITDA
 *   EBITDA - depreciation & amortization = EBIT
 *   EBIT - interest expense + interest income
 *        + other non-operating income - other non-operating expense = EBT
 *   EBT - taxes = net income
 *
 * Every membership decision is by durable account subtype (src/lib/enums.ts),
 * never by account name or code range at report runtime. An account called
 * "Interest received" must not fall below EBITDA because of its label, and a
 * chart that gets renamed must not silently change the shape of the statement.
 *
 * The four things EBITDA is "before" — interest, tax, depreciation,
 * amortization — therefore each need a subtype of their own. So does interest
 * income, which is revenue but belongs below EBIT, not inside it.
 */
const PL_SECTIONS = [
  { key: "NET_SALES", label: "Net sales", subtypes: [...INCOME_STATEMENT_SUBTYPES.NET_SALES], negate: false },
  { key: "MATERIAL_EXPENSE", label: "Material expenses", subtypes: [...INCOME_STATEMENT_SUBTYPES.MATERIAL_EXPENSE], negate: true },
  { key: "SGA", label: "Selling, general and administrative expense", subtypes: [...INCOME_STATEMENT_SUBTYPES.SGA], negate: true },
  { key: "DEPRECIATION_AMORTIZATION", label: "Depreciation & amortization", subtypes: [...INCOME_STATEMENT_SUBTYPES.DEPRECIATION_AMORTIZATION], negate: true },
  { key: "INTEREST_EXPENSE", label: "Interest expense", subtypes: [...INCOME_STATEMENT_SUBTYPES.INTEREST_EXPENSE], negate: true },
  { key: "INTEREST_INCOME", label: "Interest income", subtypes: [...INCOME_STATEMENT_SUBTYPES.INTEREST_INCOME], negate: false },
  { key: "OTHER_INCOME", label: "Other non-operating income", subtypes: [...INCOME_STATEMENT_SUBTYPES.OTHER_INCOME], negate: false },
  { key: "OTHER_EXPENSE", label: "Other non-operating expense", subtypes: [...INCOME_STATEMENT_SUBTYPES.OTHER_EXPENSE], negate: true },
  { key: "TAXES", label: "Taxes", subtypes: [...INCOME_STATEMENT_SUBTYPES.TAXES], negate: true },
] as const;

export type PlSectionKey = (typeof PL_SECTIONS)[number]["key"];

/** One reporting period, with the label its column carries. */
export interface ReportPeriod {
  label: string;
  from: Date;
  to: Date;
}

export interface StatementAccountRow {
  accountId: string;
  code: string;
  name: string;
  subtype: string;
  /**
   * One figure per period, in the same order as `periods`, already signed the
   * way the statement presents it: expenses are negative so a column can be
   * summed straight down.
   */
  amounts: number[];
}

export interface StatementSection {
  key: string;
  label: string;
  rows: StatementAccountRow[];
  /** Section total per period, signed as presented. */
  totals: number[];
}

/** A calculated line — gross profit, EBITDA, EBIT, EBT, net income. */
export interface StatementSubtotal {
  key: string;
  label: string;
  amounts: number[];
}

export interface IncomeStatement {
  periods: ReportPeriod[];
  currency: string;
  sections: StatementSection[];
  subtotals: Record<"GROSS_PROFIT" | "EBITDA" | "EBIT" | "EBT" | "NET_INCOME", StatementSubtotal>;
  /** Percentages per period; null where net sales is zero. */
  margins: Record<"GROSS" | "EBITDA" | "EBIT" | "NET", (number | null)[]>;
}

/**
 * The income statement across one or more periods.
 *
 * Each period is aggregated independently through the SAME classification, so a
 * comparison column can never be built on different rules from the column it is
 * compared against.
 */
export async function incomeStatement(
  companyId: string,
  periods: ReportPeriod[],
  currency = "CAD",
): Promise<IncomeStatement> {
  const perPeriod = await Promise.all(
    periods.map((period) =>
      balancesFor(companyId, {
        date: { gte: period.from, lte: period.to },
        accountType: { in: ["REVENUE", "EXPENSE"] },
      }),
    ),
  );

  // accountId -> balance, one map per period.
  const byPeriod = perPeriod.map((balances) => new Map(balances.map((b) => [b.accountId, b])));
  // Every account that moved in ANY period, so a column is never missing a row
  // its neighbour has.
  const seen = new Map<string, AccountBalance>();
  for (const balances of perPeriod) {
    for (const b of balances) if (!seen.has(b.accountId)) seen.set(b.accountId, b);
  }

  const sections: StatementSection[] = [];
  for (const section of PL_SECTIONS) {
    const members = [...seen.values()].filter((a) => (section.subtypes as readonly string[]).includes(a.subtype));

    const rows: StatementAccountRow[] = members
      .map((account) => ({
        accountId: account.accountId,
        code: account.code,
        name: account.name,
        subtype: account.subtype,
        // `balanceCents` is positive in the account's natural direction, so an
        // expense of 550 arrives as +550. The statement shows costs as
        // negative, hence the flip.
        amounts: byPeriod.map((map) => {
          const value = map.get(account.accountId)?.balanceCents ?? 0;
          return section.negate ? -value : value;
        }),
      }))
      .filter((row) => row.amounts.some((v) => v !== 0))
      .sort((a, b) => a.code.localeCompare(b.code));

    sections.push({
      key: section.key,
      label: section.label,
      rows,
      totals: periods.map((_, i) => rows.reduce((sum, row) => sum + row.amounts[i], 0)),
    });
  }

  const total = (key: string) => sections.find((s) => s.key === key)!.totals;
  const netSales = total("NET_SALES");
  const material = total("MATERIAL_EXPENSE");
  const sga = total("SGA");
  const da = total("DEPRECIATION_AMORTIZATION");
  const interestExpense = total("INTEREST_EXPENSE");
  const interestIncome = total("INTEREST_INCOME");
  const otherIncome = total("OTHER_INCOME");
  const otherExpense = total("OTHER_EXPENSE");
  const taxes = total("TAXES");

  // Every cost section is already negative, so each step is an addition. That
  // keeps the arithmetic identical to reading the printed column downwards.
  const each = <T,>(fn: (i: number) => T) => periods.map((_, i) => fn(i));
  const grossProfit = each((i) => netSales[i] + material[i]);
  const ebitda = each((i) => grossProfit[i] + sga[i]);
  const ebit = each((i) => ebitda[i] + da[i]);
  const ebt = each((i) => ebit[i] + interestExpense[i] + interestIncome[i] + otherIncome[i] + otherExpense[i]);
  const netIncome = each((i) => ebt[i] + taxes[i]);

  const margin = (values: number[]) =>
    each((i) => (netSales[i] === 0 ? null : (values[i] / netSales[i]) * 100));

  return {
    periods,
    currency,
    sections,
    subtotals: {
      GROSS_PROFIT: { key: "GROSS_PROFIT", label: "Gross profit", amounts: grossProfit },
      EBITDA: { key: "EBITDA", label: "EBITDA", amounts: ebitda },
      EBIT: { key: "EBIT", label: "EBIT", amounts: ebit },
      EBT: { key: "EBT", label: "EBT", amounts: ebt },
      NET_INCOME: { key: "NET_INCOME", label: "Net income", amounts: netIncome },
    },
    margins: {
      GROSS: margin(grossProfit),
      EBITDA: margin(ebitda),
      EBIT: margin(ebit),
      NET: margin(netIncome),
    },
  };
}

/**
 * Single-period figures in the shape the dashboard and cash-flow statement
 * expect.
 *
 * Kept as a thin wrapper over `incomeStatement` so there is exactly one
 * classification and one net-income calculation in the codebase — a second
 * implementation is how a dashboard and a statement start disagreeing.
 */
export async function profitAndLoss(
  companyId: string,
  range: DateRange,
  comparison?: DateRange,
) {
  const periods: ReportPeriod[] = [{ label: "Current", ...range }];
  if (comparison) periods.push({ label: "Prior", ...comparison });

  const statement = await incomeStatement(companyId, periods);
  const now = (values: number[]) => values[0];
  const was = (values: number[]) => (comparison ? values[1] : 0);
  const section = (key: string) => statement.sections.find((s) => s.key === key)!;

  // Costs are negative inside the statement; the legacy shape reports them as
  // positive magnitudes, which is what existing callers expect.
  const expenseTotal = (key: string) => -now(section(key).totals);

  return {
    range,
    comparison,
    statement,
    sections: statement.sections,
    grossProfitCents: now(statement.subtotals.GROSS_PROFIT.amounts),
    comparisonGrossProfitCents: was(statement.subtotals.GROSS_PROFIT.amounts),
    ebitdaCents: now(statement.subtotals.EBITDA.amounts),
    comparisonEbitdaCents: was(statement.subtotals.EBITDA.amounts),
    ebitCents: now(statement.subtotals.EBIT.amounts),
    comparisonEbitCents: was(statement.subtotals.EBIT.amounts),
    incomeBeforeTaxCents: now(statement.subtotals.EBT.amounts),
    comparisonIncomeBeforeTaxCents: was(statement.subtotals.EBT.amounts),
    netIncomeCents: now(statement.subtotals.NET_INCOME.amounts),
    comparisonNetIncomeCents: was(statement.subtotals.NET_INCOME.amounts),
    /** EBIT. Kept under its previous name for callers that read operating income. */
    operatingIncomeCents: now(statement.subtotals.EBIT.amounts),
    revenueCents: now(section("NET_SALES").totals),
    comparisonRevenueCents: was(section("NET_SALES").totals),
    totalExpenseCents:
      expenseTotal("MATERIAL_EXPENSE") +
      expenseTotal("SGA") +
      expenseTotal("DEPRECIATION_AMORTIZATION") +
      expenseTotal("INTEREST_EXPENSE") +
      expenseTotal("OTHER_EXPENSE") +
      expenseTotal("TAXES"),
    grossMarginPercent: statement.margins.GROSS[0],
    ebitdaMarginPercent: statement.margins.EBITDA[0],
    netMarginPercent: statement.margins.NET[0],
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
