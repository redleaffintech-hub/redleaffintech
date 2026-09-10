import "server-only";

/**
 * Financial statements (§12) — Firestore implementation.
 *
 * CRITICAL RULE (§12) preserved: every figure is aggregated from ledger lines
 * (here via the `accountPeriodBalances` roll-up + partial-month scan in
 * ./ledger-fs). Nothing reads an invoice, a bill or any UI state.
 *
 * The classification logic (PL sections, BS sections, cash-flow buckets) is
 * copied verbatim from src/server/reports/financials.ts.
 */

import {
  CASH_ASSET_SUBTYPES,
  INCOME_STATEMENT_SUBTYPES,
  NORMAL_BALANCE,
  type AccountType,
} from "@/lib/enums";
import {
  endOfMonth,
  fiscalYearOf,
  fiscalYearRange,
  monthsBetween,
  startOfMonth,
} from "@/lib/dates";
import { getCompanyOrThrow } from "@/server/db/companies";
import { listAccounts } from "@/server/db/accounts";
import { sub, toTimestamp } from "@/server/db/firestore";
import { accountRawBalanceAsOf, sumsInRange, sumsUpTo, type AccountSum } from "./ledger-fs";
import type { Account } from "@/server/db/types";

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
  balanceCents: number;
}

function join(accounts: Account[], sums: Map<string, AccountSum>): AccountBalance[] {
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

async function balancesInRange(companyId: string, from: Date, to: Date): Promise<AccountBalance[]> {
  const [accounts, sums] = await Promise.all([
    listAccounts(companyId),
    sumsInRange(companyId, from, to),
  ]);
  return join(accounts, sums);
}

async function balancesUpTo(
  companyId: string,
  cutoff: Date,
  opts: { inclusive?: boolean } = {},
): Promise<AccountBalance[]> {
  const [accounts, sums] = await Promise.all([
    listAccounts(companyId),
    sumsUpTo(companyId, cutoff, opts),
  ]);
  return join(accounts, sums);
}

// ── Trial balance ───────────────────────────────────────────────────────────

export interface TrialBalanceRow extends AccountBalance {
  openingCents: number;
  periodDebitCents: number;
  periodCreditCents: number;
  closingCents: number;
}

export async function trialBalance(companyId: string, range: DateRange) {
  const [opening, period] = await Promise.all([
    balancesUpTo(companyId, range.from, { inclusive: false }),
    balancesInRange(companyId, range.from, range.to),
  ]);
  const openingById = new Map(opening.map((o) => [o.accountId, o]));

  const rows: TrialBalanceRow[] = period
    .map((p) => {
      const openingCents = openingById.get(p.accountId)?.balanceCents ?? 0;
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
  const closingDebitCents = rows.reduce(
    (s, r) =>
      s + (NORMAL_BALANCE[r.type] === "DEBIT" ? Math.max(r.closingCents, 0) : Math.max(-r.closingCents, 0)),
    0,
  );
  const closingCreditCents = rows.reduce(
    (s, r) =>
      s + (NORMAL_BALANCE[r.type] === "CREDIT" ? Math.max(r.closingCents, 0) : Math.max(-r.closingCents, 0)),
    0,
  );

  return {
    rows,
    totalDebitCents,
    totalCreditCents,
    closingDebitCents,
    closingCreditCents,
    balanced:
      totalDebitCents === totalCreditCents && closingDebitCents === closingCreditCents,
  };
}

// ── Profit & Loss ───────────────────────────────────────────────────────────

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
  amounts: number[];
}

export interface StatementSection {
  key: string;
  label: string;
  rows: StatementAccountRow[];
  totals: number[];
}

export interface IncomeStatement {
  periods: ReportPeriod[];
  currency: string;
  sections: StatementSection[];
  subtotals: Record<
    "GROSS_PROFIT" | "EBITDA" | "EBIT" | "EBT" | "NET_INCOME",
    { key: string; label: string; amounts: number[] }
  >;
  margins: Record<"GROSS" | "EBITDA" | "EBIT" | "NET", (number | null)[]>;
}

export async function incomeStatement(
  companyId: string,
  periods: ReportPeriod[],
  currency = "CAD",
): Promise<IncomeStatement> {
  const perPeriod = await Promise.all(
    periods.map((period) =>
      balancesInRange(companyId, period.from, period.to).then((bs) =>
        bs.filter((b) => b.type === "REVENUE" || b.type === "EXPENSE"),
      ),
    ),
  );

  const byPeriod = perPeriod.map((balances) => new Map(balances.map((b) => [b.accountId, b])));
  const seen = new Map<string, AccountBalance>();
  for (const balances of perPeriod) {
    for (const b of balances) if (!seen.has(b.accountId)) seen.set(b.accountId, b);
  }

  const sections: StatementSection[] = [];
  for (const section of PL_SECTIONS) {
    const members = [...seen.values()].filter((a) =>
      (section.subtypes as readonly string[]).includes(a.subtype),
    );
    const rows: StatementAccountRow[] = members
      .map((account) => ({
        accountId: account.accountId,
        code: account.code,
        name: account.name,
        subtype: account.subtype,
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

  const each = <T,>(fn: (i: number) => T) => periods.map((_, i) => fn(i));
  const grossProfit = each((i) => netSales[i] + material[i]);
  const ebitda = each((i) => grossProfit[i] + sga[i]);
  const ebit = each((i) => ebitda[i] + da[i]);
  const ebt = each(
    (i) => ebit[i] + interestExpense[i] + interestIncome[i] + otherIncome[i] + otherExpense[i],
  );
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

export async function profitAndLoss(companyId: string, range: DateRange, comparison?: DateRange) {
  const periods: ReportPeriod[] = [{ label: "Current", ...range }];
  if (comparison) periods.push({ label: "Prior", ...comparison });
  const statement = await incomeStatement(companyId, periods);
  const now = (v: number[]) => v[0];
  const was = (v: number[]) => (comparison ? v[1] : 0);
  const section = (key: string) => statement.sections.find((s) => s.key === key)!;
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

export async function monthlyPerformance(companyId: string, range: DateRange) {
  const buckets = new Map<string, { month: Date; revenueCents: number; expenseCents: number }>();
  for (const month of monthsBetween(range.from, range.to)) {
    buckets.set(month.toISOString(), { month, revenueCents: 0, expenseCents: 0 });
  }
  for (const month of monthsBetween(range.from, range.to)) {
    const balances = (await balancesInRange(companyId, startOfMonth(month), endOfMonth(month))).filter(
      (b) => b.type === "REVENUE" || b.type === "EXPENSE",
    );
    const bucket = buckets.get(month.toISOString())!;
    for (const b of balances) {
      if (b.type === "REVENUE") bucket.revenueCents += b.balanceCents;
      else bucket.expenseCents += b.balanceCents;
    }
  }
  return [...buckets.values()].map((b) => ({
    ...b,
    netIncomeCents: b.revenueCents - b.expenseCents,
  }));
}

// ── Balance Sheet ───────────────────────────────────────────────────────────

const BS_SECTIONS = [
  { key: "CURRENT_ASSETS", label: "Current assets", type: "ASSET", subtypes: ["BANK", "CASH", "ACCOUNTS_RECEIVABLE", "OTHER_CURRENT_ASSET", "PREPAID_EXPENSE", "INVENTORY", "TAX_RECOVERABLE"] },
  { key: "FIXED_ASSETS", label: "Property & equipment", type: "ASSET", subtypes: ["FIXED_ASSET", "ACCUMULATED_DEPRECIATION"] },
  { key: "CURRENT_LIABILITIES", label: "Current liabilities", type: "LIABILITY", subtypes: ["ACCOUNTS_PAYABLE", "CREDIT_CARD", "SALES_TAX_PAYABLE", "PAYROLL_LIABILITY", "OTHER_CURRENT_LIABILITY"] },
  { key: "LONG_TERM_LIABILITIES", label: "Long-term liabilities", type: "LIABILITY", subtypes: ["LONG_TERM_LIABILITY"] },
  { key: "EQUITY", label: "Equity", type: "EQUITY", subtypes: ["SHARE_CAPITAL", "OWNER_EQUITY", "RETAINED_EARNINGS", "DRAWINGS"] },
] as const;

export async function balanceSheet(companyId: string, asOf: Date, comparisonDate?: Date) {
  const [current, prior] = await Promise.all([
    balancesUpTo(companyId, asOf, { inclusive: true }),
    comparisonDate
      ? balancesUpTo(companyId, comparisonDate, { inclusive: true })
      : Promise.resolve([] as AccountBalance[]),
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

  const currentEarningsCents =
    current.filter((a) => a.type === "REVENUE").reduce((s, a) => s + a.balanceCents, 0) -
    current.filter((a) => a.type === "EXPENSE").reduce((s, a) => s + a.balanceCents, 0);
  const priorEarningsCents =
    prior.filter((a) => a.type === "REVENUE").reduce((s, a) => s + a.balanceCents, 0) -
    prior.filter((a) => a.type === "EXPENSE").reduce((s, a) => s + a.balanceCents, 0);

  const find = (key: string) => sections.find((s) => s.key === key)!;
  const totalAssetsCents = find("CURRENT_ASSETS").totalCents + find("FIXED_ASSETS").totalCents;
  const totalLiabilitiesCents =
    find("CURRENT_LIABILITIES").totalCents + find("LONG_TERM_LIABILITIES").totalCents;
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
    outOfBalanceCents: totalAssetsCents - (totalLiabilitiesCents + totalEquityCents),
  };
}

// ── Cash flow (indirect) ────────────────────────────────────────────────────

const CASH_FLOW_CLASS: Record<string, "OPERATING" | "INVESTING" | "FINANCING"> = {
  ACCOUNTS_RECEIVABLE: "OPERATING",
  OTHER_CURRENT_ASSET: "OPERATING",
  PREPAID_EXPENSE: "OPERATING",
  TAX_RECOVERABLE: "OPERATING",
  INVENTORY: "OPERATING",
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

export async function cashFlow(companyId: string, range: DateRange) {
  const [movements, openingCash] = await Promise.all([
    balancesInRange(companyId, range.from, range.to),
    balancesUpTo(companyId, range.from, { inclusive: false }),
  ]);

  const sections: Record<
    "OPERATING" | "INVESTING" | "FINANCING",
    { name: string; code: string; amountCents: number }[]
  > = { OPERATING: [], INVESTING: [], FINANCING: [] };

  let netIncomeCents = 0;
  for (const account of movements) {
    const netDebit = account.debitCents - account.creditCents;
    if ((CASH_ASSET_SUBTYPES as readonly string[]).includes(account.subtype)) continue;
    if (account.type === "REVENUE" || account.type === "EXPENSE") {
      netIncomeCents += -netDebit;
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

  const isCash = (a: AccountBalance) => (CASH_ASSET_SUBTYPES as readonly string[]).includes(a.subtype);
  const cashOpeningCents = openingCash.filter(isCash).reduce((s, a) => s + a.balanceCents, 0);
  const cashMovementCents = movements.filter(isCash).reduce((s, a) => s + a.balanceCents, 0);

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
    tieOutCents: operatingCents + investingCents + financingCents - cashMovementCents,
  };
}

// ── General ledger (line-level) ─────────────────────────────────────────────

export async function generalLedger(
  companyId: string,
  range: DateRange,
  options: { accountIds?: string[]; sourceType?: string; limit?: number } = {},
) {
  const accounts = await listAccounts(companyId);
  const wanted = options.accountIds?.length
    ? accounts.filter((a) => options.accountIds!.includes(a.id))
    : accounts;

  const opening = await sumsUpTo(companyId, range.from, { inclusive: false });

  const snap = await sub(companyId, "journalLines")
    .where("date", ">=", toTimestamp(range.from))
    .where("date", "<=", toTimestamp(range.to))
    .orderBy("date")
    .get();

  interface GlLine {
    id: string;
    accountId: string;
    journalEntryId: string;
    lineNo: number;
    date: Date;
    debitCents: number;
    creditCents: number;
    description: string | null;
  }
  const allLines: GlLine[] = snap.docs.map((d) => {
    const raw = d.data();
    return {
      id: d.id,
      accountId: raw.accountId,
      journalEntryId: raw.journalEntryId,
      lineNo: raw.lineNo ?? 0,
      date: (raw.date as FirebaseFirestore.Timestamp).toDate(),
      debitCents: raw.debitCents ?? 0,
      creditCents: raw.creditCents ?? 0,
      description: raw.description ?? null,
    };
  });

  const byAccount = new Map<string, GlLine[]>();
  for (const line of allLines) {
    if (options.accountIds?.length && !options.accountIds.includes(line.accountId)) continue;
    const list = byAccount.get(line.accountId) ?? [];
    list.push(line);
    byAccount.set(line.accountId, list);
  }

  return wanted
    .map((account) => {
      const lines = (byAccount.get(account.id) ?? []).sort(
        (a, b) => a.date.getTime() - b.date.getTime() || a.lineNo - b.lineNo,
      );
      const isDebitNatural = NORMAL_BALANCE[account.type as AccountType] === "DEBIT";
      const o = opening.get(account.id);
      const openingSigned = (o?.debitCents ?? 0) - (o?.creditCents ?? 0);
      let running = openingSigned;
      const rows = lines.map((line) => {
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

// ── Shared helpers ─────────────────────────────────────────────────────────

export async function currentFiscalRange(companyId: string, asOf = new Date()): Promise<DateRange> {
  const company = await getCompanyOrThrow(companyId);
  const year = fiscalYearOf(asOf, company.fiscalYearStartMonth);
  const { start, end } = fiscalYearRange(year, company.fiscalYearStartMonth);
  return { from: start, to: end < asOf ? end : endOfMonth(asOf) };
}

export async function accountBalance(companyId: string, accountId: string, asOf: Date) {
  return accountRawBalanceAsOf(companyId, accountId, asOf);
}
