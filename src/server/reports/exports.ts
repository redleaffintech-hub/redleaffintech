import "server-only";

import { db } from "@/lib/db";
import {
  csvDate,
  csvFile,
  csvMoney,
  csvRate,
  moneyHeader,
  rangeFilename,
  asOfFilename,
  type CsvColumn,
} from "@/lib/csv";
import { NORMAL_BALANCE, type AccountType } from "@/lib/enums";
import { CAPABILITIES, type Capability } from "@/lib/permissions";
import { isoDate, toUtcDay, today, fiscalYearOf, fiscalYearRange } from "@/lib/dates";
import {
  balanceSheet,
  cashFlow,
  generalLedger,
  incomeStatement,
  trialBalance,
  type ReportPeriod,
} from "./financials";
import { apAging, arAging, partyStatement } from "./aging";
import { taxDetail, taxSummary } from "./tax";

/**
 * CSV export definitions.
 *
 * One registry rather than an export endpoint per report, so the authorisation,
 * escaping, filename and content-type rules are written once and every report
 * inherits them. A definition never receives a company id from the caller — the
 * route resolves it from the session and passes it in.
 *
 * Each definition re-runs the same query the page runs, from the same search
 * params, which is what makes the file match what the reader is looking at and
 * why it contains the whole filtered set rather than one page of rows.
 */

export interface ExportContext {
  companyId: string;
  /** The company's base currency, for money column headings. */
  currency: string;
  fiscalYearStartMonth: number;
  params: URLSearchParams;
}

export interface ExportResult {
  filename: string;
  body: string;
}

export interface ExportDefinition {
  /** Capability the user must hold. Checked before anything is read. */
  capability: Capability;
  build: (ctx: ExportContext) => Promise<ExportResult>;
}

// ── Shared parameter parsing ────────────────────────────────────────────────

/** The period a report was run for, defaulting to the current fiscal year. */
function rangeFrom(ctx: ExportContext) {
  const defaults = fiscalYearRange(
    fiscalYearOf(today(), ctx.fiscalYearStartMonth),
    ctx.fiscalYearStartMonth,
  );
  const fromParam = ctx.params.get("from");
  const toParam = ctx.params.get("to");
  return {
    from: toUtcDay(fromParam || isoDate(defaults.start)),
    to: toUtcDay(toParam || isoDate(today())),
  };
}

function asOfFrom(ctx: ExportContext) {
  const asOf = ctx.params.get("asOf");
  return toUtcDay(asOf || isoDate(today()));
}

/** `Debit (CAD)` etc. */
const money = (label: string, ctx: ExportContext) => moneyHeader(label, ctx.currency);


/**
 * The fiscal periods an income-statement export covers.
 *
 * Mirrors the page: `end` is the fiscal year of the rightmost column and
 * `periods` how many columns back from it, defaulting to the current year and
 * three before it. Clamped to four, which is what fits a printed page.
 */
function incomeStatementPeriods(ctx: ExportContext) {
  const currentFy = fiscalYearOf(today(), ctx.fiscalYearStartMonth);
  const requestedEnd = Number(ctx.params.get("end") ?? "");
  const endYear =
    Number.isInteger(requestedEnd) && requestedEnd > 1900 && requestedEnd < 2200 ? requestedEnd : currentFy;

  const requestedCount = Number(ctx.params.get("periods") ?? "");
  const count = Number.isInteger(requestedCount) && requestedCount >= 1 && requestedCount <= 4 ? requestedCount : 4;

  const periods: ReportPeriod[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const year = endYear - offset;
    const range = fiscalYearRange(year, ctx.fiscalYearStartMonth);
    const to = year === currentFy && range.end > today() ? today() : range.end;
    const month = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" }).format(range.end);
    periods.push({
      label: `${month}-${String(range.end.getUTCFullYear()).slice(2)}`,
      from: range.start,
      to,
    });
  }
  return { periods, endYear, count };
}

// ── Financial statements ────────────────────────────────────────────────────

const trialBalanceExport: ExportDefinition = {
  capability: CAPABILITIES.REPORTS,
  build: async (ctx) => {
    const range = rangeFrom(ctx);
    const report = await trialBalance(ctx.companyId, range);
    type Row = (typeof report.rows)[number];

    const columns: CsvColumn<Row>[] = [
      { header: "Account code", value: (r) => r.code },
      { header: "Account name", value: (r) => r.name },
      { header: "Type", value: (r) => r.type },
      { header: "Classification", value: (r) => r.subtype },
      { header: money("Opening", ctx), value: (r) => csvMoney(r.openingCents), numeric: true },
      { header: money("Period debit", ctx), value: (r) => csvMoney(r.periodDebitCents), numeric: true },
      { header: money("Period credit", ctx), value: (r) => csvMoney(r.periodCreditCents), numeric: true },
      { header: money("Closing", ctx), value: (r) => csvMoney(r.closingCents), numeric: true },
    ];

    // Totals as a final row: a trial balance that does not show its own
    // debit/credit totals is not a trial balance.
    const rows: Row[] = [
      ...report.rows,
      {
        accountId: "",
        code: "",
        name: "Total",
        type: "ASSET" as AccountType,
        subtype: "",
        debitCents: 0,
        creditCents: 0,
        balanceCents: 0,
        openingCents: 0,
        periodDebitCents: report.totalDebitCents,
        periodCreditCents: report.totalCreditCents,
        closingCents: 0,
      },
    ];

    return {
      filename: rangeFilename("trial-balance", range.from, range.to),
      body: csvFile(rows, columns),
    };
  },
};

const incomeStatementExport: ExportDefinition = {
  capability: CAPABILITIES.REPORTS,
  build: async (ctx) => {
    const { periods, endYear, count } = incomeStatementPeriods(ctx);
    const statement = await incomeStatement(ctx.companyId, periods, ctx.currency);

    /**
     * The rows in exactly the order the report shows them, so a reader can put
     * the file beside the screen and follow it line for line. Detail rows carry
     * their account code and name; calculated rows are marked as subtotals.
     *
     * Amounts are plain decimals with a leading minus — never accounting
     * parentheses, which a spreadsheet reads as text rather than as a number.
     */
    interface Line {
      row: string;
      kind: "Category" | "Account" | "Subtotal";
      code: string;
      account: string;
      amounts: number[];
    }

    const find = (key: string) => statement.sections.find((s) => s.key === key)!;
    const lines: Line[] = [];

    const category = (key: string) => {
      const section = find(key);
      if (section.rows.length === 0) return;
      lines.push({ row: section.label, kind: "Category", code: "", account: "", amounts: section.totals });
      // Detail beneath the category, matching an expanded report.
      if (section.rows.length > 1) {
        for (const account of section.rows) {
          lines.push({
            row: section.label,
            kind: "Account",
            code: account.code,
            account: account.name,
            amounts: account.amounts,
          });
        }
      } else {
        const only = section.rows[0];
        lines.push({ row: section.label, kind: "Account", code: only.code, account: only.name, amounts: only.amounts });
      }
    };
    const subtotal = (key: keyof typeof statement.subtotals) => {
      const s = statement.subtotals[key];
      lines.push({ row: s.label, kind: "Subtotal", code: "", account: "", amounts: s.amounts });
    };

    category("NET_SALES");
    category("MATERIAL_EXPENSE");
    subtotal("GROSS_PROFIT");
    category("SGA");
    subtotal("EBITDA");
    category("DEPRECIATION_AMORTIZATION");
    subtotal("EBIT");
    category("INTEREST_EXPENSE");
    category("INTEREST_INCOME");
    category("OTHER_INCOME");
    category("OTHER_EXPENSE");
    subtotal("EBT");
    category("TAXES");
    subtotal("NET_INCOME");

    const columns: CsvColumn<Line>[] = [
      { header: "Row", value: (l) => l.row },
      { header: "Line type", value: (l) => l.kind },
      { header: "Account code", value: (l) => l.code },
      { header: "Account name", value: (l) => l.account },
      { header: "Currency", value: () => ctx.currency },
      ...statement.periods.map((period, i) => ({
        header: moneyHeader(period.label, ctx.currency),
        value: (l: Line) => csvMoney(l.amounts[i] ?? 0),
        numeric: true,
      })),
    ];

    // income-statement-FY2023-to-FY2026.csv
    const firstYear = endYear - count + 1;
    return {
      filename: `income-statement-FY${firstYear}-to-FY${endYear}.csv`,
      body: csvFile(lines, columns),
    };
  },
};

const balanceSheetExport: ExportDefinition = {
  capability: CAPABILITIES.REPORTS,
  build: async (ctx) => {
    const asOf = asOfFrom(ctx);
    const report = await balanceSheet(ctx.companyId, asOf);

    interface Line {
      section: string;
      code: string;
      label: string;
      amount: number;
      kind: "Account" | "Subtotal";
    }
    const lines: Line[] = [];
    for (const found of report.sections) {
      for (const row of found.rows) {
        lines.push({ section: found.label, code: row.code, label: row.name, amount: row.balanceCents, kind: "Account" });
      }
      lines.push({
        section: found.label,
        code: "",
        label: `Total ${found.label.toLowerCase()}`,
        amount: found.totalCents,
        kind: "Subtotal",
      });
    }
    lines.push({ section: "", code: "", label: "Current earnings", amount: report.currentEarningsCents, kind: "Subtotal" });
    lines.push({ section: "", code: "", label: "Total assets", amount: report.totalAssetsCents, kind: "Subtotal" });
    lines.push({ section: "", code: "", label: "Total liabilities", amount: report.totalLiabilitiesCents, kind: "Subtotal" });
    lines.push({ section: "", code: "", label: "Total equity", amount: report.totalEquityCents, kind: "Subtotal" });
    lines.push({
      section: "",
      code: "",
      label: "Total liabilities and equity",
      amount: report.totalLiabilitiesAndEquityCents,
      kind: "Subtotal",
    });

    const columns: CsvColumn<Line>[] = [
      { header: "Section", value: (l) => l.section },
      { header: "Line type", value: (l) => l.kind },
      { header: "Account code", value: (l) => l.code },
      { header: "Line", value: (l) => l.label },
      { header: money("Amount", ctx), value: (l) => csvMoney(l.amount), numeric: true },
    ];

    return { filename: asOfFilename("balance-sheet", asOf), body: csvFile(lines, columns) };
  },
};

const cashFlowExport: ExportDefinition = {
  capability: CAPABILITIES.REPORTS,
  build: async (ctx) => {
    const range = rangeFrom(ctx);
    const report = await cashFlow(ctx.companyId, range);

    interface Line {
      section: string;
      code?: string;
      label: string;
      amount: number;
      kind: "Item" | "Subtotal";
    }
    const lines: Line[] = [
      { section: "Operating", label: "Net income for the period", amount: report.netIncomeCents, kind: "Item" },
      ...report.operatingItems.map((i) => ({ section: "Operating", code: i.code, label: i.name, amount: i.amountCents, kind: "Item" as const })),
      { section: "Operating", label: "Net cash from operating activities", amount: report.operatingCents, kind: "Subtotal" },
      ...report.investingItems.map((i) => ({ section: "Investing", code: i.code, label: i.name, amount: i.amountCents, kind: "Item" as const })),
      { section: "Investing", label: "Net cash from investing activities", amount: report.investingCents, kind: "Subtotal" },
      ...report.financingItems.map((i) => ({ section: "Financing", code: i.code, label: i.name, amount: i.amountCents, kind: "Item" as const })),
      { section: "Financing", label: "Net cash from financing activities", amount: report.financingCents, kind: "Subtotal" },
      { section: "", label: "Net change in cash", amount: report.netChangeCents, kind: "Subtotal" },
      { section: "", label: "Cash at start of period", amount: report.cashOpeningCents, kind: "Subtotal" },
      { section: "", label: "Cash at end of period", amount: report.cashClosingCents, kind: "Subtotal" },
    ];

    const columns: CsvColumn<Line>[] = [
      { header: "Section", value: (l) => l.section },
      { header: "Line type", value: (l) => l.kind },
      { header: "Account code", value: (l) => l.code ?? "" },
      { header: "Line", value: (l) => l.label },
      { header: money("Amount", ctx), value: (l) => csvMoney(l.amount), numeric: true },
    ];

    return { filename: rangeFilename("cash-flow", range.from, range.to), body: csvFile(lines, columns) };
  },
};

// ── Ledger ──────────────────────────────────────────────────────────────────

const generalLedgerExport: ExportDefinition = {
  capability: CAPABILITIES.REPORTS,
  build: async (ctx) => {
    const range = rangeFrom(ctx);
    const accountId = ctx.params.get("account");
    const groups = await generalLedger(ctx.companyId, range, accountId ? { accountIds: [accountId] } : {});

    interface Line {
      code: string;
      account: string;
      date: Date | null;
      entryNo: string;
      source: string;
      sourceNumber: string;
      description: string;
      debit: number;
      credit: number;
      balance: number;
    }

    const lines: Line[] = [];
    for (const group of groups) {
      lines.push({
        code: group.account.code,
        account: group.account.name,
        date: null,
        entryNo: "",
        source: "",
        sourceNumber: "",
        description: "Opening balance",
        debit: 0,
        credit: 0,
        balance: group.openingBalanceCents,
      });
      for (const row of group.rows) {
        lines.push({
          code: group.account.code,
          account: group.account.name,
          date: row.date,
          entryNo: row.journalEntry?.entryNo ?? "",
          source: row.journalEntry?.sourceType ?? "",
          sourceNumber: row.journalEntry?.sourceNumber ?? "",
          description: row.description ?? row.journalEntry?.memo ?? "",
          debit: row.debitCents,
          credit: row.creditCents,
          balance: row.runningBalanceCents,
        });
      }
      lines.push({
        code: group.account.code,
        account: group.account.name,
        date: null,
        entryNo: "",
        source: "",
        sourceNumber: "",
        description: "Closing balance",
        debit: group.totalDebitCents,
        credit: group.totalCreditCents,
        balance: group.closingBalanceCents,
      });
    }

    const columns: CsvColumn<Line>[] = [
      { header: "Account code", value: (l) => l.code },
      { header: "Account name", value: (l) => l.account },
      { header: "Date", value: (l) => csvDate(l.date) },
      { header: "Entry no.", value: (l) => l.entryNo },
      { header: "Source", value: (l) => l.source },
      { header: "Source document", value: (l) => l.sourceNumber },
      { header: "Description", value: (l) => l.description },
      { header: money("Debit", ctx), value: (l) => csvMoney(l.debit), numeric: true },
      { header: money("Credit", ctx), value: (l) => csvMoney(l.credit), numeric: true },
      { header: money("Running balance", ctx), value: (l) => csvMoney(l.balance), numeric: true },
    ];

    return { filename: rangeFilename("general-ledger", range.from, range.to), body: csvFile(lines, columns) };
  },
};

const journalReportExport: ExportDefinition = {
  capability: CAPABILITIES.REPORTS,
  build: async (ctx) => {
    const range = rangeFrom(ctx);
    const source = ctx.params.get("source") ?? "";

    // Every line of every entry in the period — the journal report drilled all
    // the way down, which is what makes the file useful outside the app.
    const entries = await db.journalEntry.findMany({
      where: {
        companyId: ctx.companyId,
        date: { gte: range.from, lte: range.to },
        ...(source ? { sourceType: source } : {}),
      },
      include: {
        lines: {
          orderBy: { lineNo: "asc" },
          include: { account: { select: { code: true, name: true } } },
        },
      },
      orderBy: [{ date: "asc" }, { entryNo: "asc" }],
    });

    interface Line {
      date: Date;
      entryNo: string;
      source: string;
      sourceNumber: string | null;
      memo: string | null;
      status: string;
      lineNo: number;
      code: string;
      account: string;
      description: string | null;
      debit: number;
      credit: number;
    }

    const lines: Line[] = entries.flatMap((entry) =>
      entry.lines.map((line) => ({
        date: entry.date,
        entryNo: entry.entryNo,
        source: entry.sourceType,
        sourceNumber: entry.sourceNumber,
        memo: entry.memo,
        status: entry.status,
        lineNo: line.lineNo,
        code: line.account.code,
        account: line.account.name,
        description: line.description,
        debit: line.debitCents,
        credit: line.creditCents,
      })),
    );

    const columns: CsvColumn<Line>[] = [
      { header: "Date", value: (l) => csvDate(l.date) },
      { header: "Entry no.", value: (l) => l.entryNo },
      { header: "Source", value: (l) => l.source },
      { header: "Source document", value: (l) => l.sourceNumber },
      { header: "Status", value: (l) => l.status },
      { header: "Memo", value: (l) => l.memo },
      { header: "Line", value: (l) => l.lineNo, numeric: true },
      { header: "Account code", value: (l) => l.code },
      { header: "Account name", value: (l) => l.account },
      { header: "Line description", value: (l) => l.description },
      { header: money("Debit", ctx), value: (l) => csvMoney(l.debit), numeric: true },
      { header: money("Credit", ctx), value: (l) => csvMoney(l.credit), numeric: true },
    ];

    return { filename: rangeFilename("journal-report", range.from, range.to), body: csvFile(lines, columns) };
  },
};

// ── Receivables & payables ──────────────────────────────────────────────────

function agingExport(kind: "AR" | "AP"): ExportDefinition {
  return {
    capability: CAPABILITIES.REPORTS,
    build: async (ctx) => {
      const asOf = asOfFrom(ctx);
      const report = kind === "AR" ? await arAging(ctx.companyId, asOf) : await apAging(ctx.companyId, asOf);
      const partyLabel = kind === "AR" ? "Customer" : "Vendor";

      // One row per open document, with its party — an aging summary alone
      // cannot be reconciled against anything outside the app.
      interface Line {
        party: string;
        email: string | null;
        number: string;
        date: Date;
        dueDate: Date;
        daysOverdue: number;
        status: string;
        balance: number;
      }
      const lines: Line[] = report.rows.flatMap((row) =>
        row.documents.map((doc) => ({
          party: row.partyName,
          email: row.email,
          number: doc.number,
          date: doc.date,
          dueDate: doc.dueDate,
          daysOverdue: doc.daysOverdue,
          status: doc.status,
          balance: doc.balanceCents,
        })),
      );

      const columns: CsvColumn<Line>[] = [
        { header: partyLabel, value: (l) => l.party },
        { header: "Email", value: (l) => l.email },
        { header: "Document", value: (l) => l.number },
        { header: "Date", value: (l) => csvDate(l.date) },
        { header: "Due date", value: (l) => csvDate(l.dueDate) },
        { header: "Days overdue", value: (l) => l.daysOverdue, numeric: true },
        { header: "Status", value: (l) => l.status },
        { header: money("Balance", ctx), value: (l) => csvMoney(l.balance), numeric: true },
      ];

      return {
        filename: asOfFilename(kind === "AR" ? "ar-aging" : "ap-aging", asOf),
        body: csvFile(lines, columns),
      };
    },
  };
}

function statementExport(kind: "customer" | "vendor"): ExportDefinition {
  return {
    capability: CAPABILITIES.REPORTS,
    build: async (ctx) => {
      const range = rangeFrom(ctx);
      const partyId = ctx.params.get("party") ?? "";
      if (!partyId) throw new ExportError("No customer or vendor was specified.", 400);

      // Confirm the party belongs to this company before reading anything: the
      // id came off a URL, so it is not to be trusted on its own.
      const party =
        kind === "customer"
          ? await db.customer.findFirst({ where: { id: partyId, companyId: ctx.companyId }, select: { name: true } })
          : await db.vendor.findFirst({ where: { id: partyId, companyId: ctx.companyId }, select: { name: true } });
      if (!party) throw new ExportError("That party does not belong to this company.", 404);

      const statement = await partyStatement(
        ctx.companyId,
        kind === "customer" ? { customerId: partyId } : { vendorId: partyId },
        range.from,
        range.to,
      );
      type Row = (typeof statement.rows)[number];

      const columns: CsvColumn<Row>[] = [
        { header: "Date", value: (r) => csvDate(r.date) },
        { header: "Entry no.", value: (r) => r.journalEntry.entryNo },
        { header: "Source", value: (r) => r.journalEntry.sourceType },
        { header: "Document", value: (r) => r.journalEntry.sourceNumber },
        { header: "Description", value: (r) => r.description ?? r.journalEntry.memo },
        { header: money("Debit", ctx), value: (r) => csvMoney(r.debitCents), numeric: true },
        { header: money("Credit", ctx), value: (r) => csvMoney(r.creditCents), numeric: true },
        // Signed in the party's favour: positive means they owe more.
        { header: money("Movement", ctx), value: (r) => csvMoney(r.movementCents), numeric: true },
        { header: money("Running balance", ctx), value: (r) => csvMoney(r.runningBalanceCents), numeric: true },
      ];

      return {
        filename: rangeFilename(`${kind}-statement-${party.name}`, range.from, range.to),
        body: csvFile(statement.rows, columns),
      };
    },
  };
}

// ── Tax ─────────────────────────────────────────────────────────────────────

const taxSummaryExport: ExportDefinition = {
  capability: CAPABILITIES.TAX_FILING,
  build: async (ctx) => {
    const range = rangeFrom(ctx);
    const report = await taxSummary(ctx.companyId, range);
    type Row = (typeof report.rows)[number];

    const columns: CsvColumn<Row>[] = [
      { header: "Tax kind", value: (r) => r.kind },
      { header: "Jurisdiction", value: (r) => r.jurisdiction },
      { header: "Tax code", value: (r) => r.taxCode },
      { header: "Tax code name", value: (r) => r.taxCodeName },
      { header: money("Taxable sales", ctx), value: (r) => csvMoney(r.salesTaxableCents), numeric: true },
      { header: money("Tax collected", ctx), value: (r) => csvMoney(r.taxCollectedCents), numeric: true },
      { header: money("Taxable purchases", ctx), value: (r) => csvMoney(r.purchaseTaxableCents), numeric: true },
      { header: money("Tax paid", ctx), value: (r) => csvMoney(r.taxPaidCents), numeric: true },
      { header: money("Recoverable (ITC)", ctx), value: (r) => csvMoney(r.recoverableCents), numeric: true },
      { header: money("Net", ctx), value: (r) => csvMoney(r.netCents), numeric: true },
    ];

    const rows: Row[] = [
      ...report.rows,
      {
        kind: "",
        jurisdiction: "",
        taxCode: "",
        taxCodeName: "Total",
        ...report.totals,
      },
    ];

    return { filename: rangeFilename("tax-summary", range.from, range.to), body: csvFile(rows, columns) };
  },
};

const taxDetailExport: ExportDefinition = {
  capability: CAPABILITIES.TAX_FILING,
  build: async (ctx) => {
    const range = rangeFrom(ctx);
    const direction = ctx.params.get("direction");
    const kind = ctx.params.get("kind");
    const entries = await taxDetail(ctx.companyId, range, {
      direction: direction === "SALE" || direction === "PURCHASE" ? direction : undefined,
      kind: kind || undefined,
      taxCodeId: ctx.params.get("taxCode") || undefined,
    });
    type Row = (typeof entries)[number];

    const columns: CsvColumn<Row>[] = [
      { header: "Date", value: (r) => csvDate(r.date) },
      { header: "Entry no.", value: (r) => r.journalEntry?.entryNo ?? "" },
      { header: "Direction", value: (r) => r.direction },
      { header: "Tax kind", value: (r) => r.kind },
      { header: "Tax code", value: (r) => r.taxCode?.code ?? "" },
      { header: "Tax code name", value: (r) => r.taxCode?.name ?? "" },
      // The rate that was in force when the entry posted, not today's rate.
      { header: "Rate (%)", value: (r) => csvRate(r.rateMicro), numeric: true },
      { header: money("Taxable amount", ctx), value: (r) => csvMoney(r.taxableCents), numeric: true },
      { header: money("Tax amount", ctx), value: (r) => csvMoney(r.taxCents), numeric: true },
    ];

    return { filename: rangeFilename("tax-detail", range.from, range.to), body: csvFile(entries, columns) };
  },
};

// ── Budget ──────────────────────────────────────────────────────────────────

const budgetVsActualExport: ExportDefinition = {
  capability: CAPABILITIES.REPORTS,
  build: async (ctx) => {
    const range = rangeFrom(ctx);
    const [budget, actuals, accounts] = await Promise.all([
      db.budget.findFirst({
        where: { companyId: ctx.companyId },
        include: { lines: true },
        orderBy: { createdAt: "desc" },
      }),
      db.journalLine.groupBy({
        by: ["accountId"],
        where: { companyId: ctx.companyId, date: { gte: range.from, lte: range.to } },
        _sum: { debitCents: true, creditCents: true },
      }),
      db.account.findMany({
        where: { companyId: ctx.companyId, type: { in: ["REVENUE", "EXPENSE"] } },
        select: { id: true, code: true, name: true, type: true },
        orderBy: { code: "asc" },
      }),
    ]);

    const actualByAccount = new Map(
      actuals.map((a) => {
        const debit = a._sum.debitCents ?? 0;
        const credit = a._sum.creditCents ?? 0;
        return [a.accountId, { debit, credit }];
      }),
    );
    const budgetByAccount = new Map((budget?.lines ?? []).map((l) => [l.accountId, l.amountCents]));

    interface Line {
      code: string;
      name: string;
      type: string;
      budget: number;
      actual: number;
      variance: number;
    }

    const lines: Line[] = accounts.map((account) => {
      const sums = actualByAccount.get(account.id);
      const actual =
        NORMAL_BALANCE[account.type as AccountType] === "DEBIT"
          ? (sums?.debit ?? 0) - (sums?.credit ?? 0)
          : (sums?.credit ?? 0) - (sums?.debit ?? 0);
      const budgeted = budgetByAccount.get(account.id) ?? 0;
      return {
        code: account.code,
        name: account.name,
        type: account.type,
        budget: budgeted,
        actual,
        variance: actual - budgeted,
      };
    });

    const columns: CsvColumn<Line>[] = [
      { header: "Account code", value: (l) => l.code },
      { header: "Account name", value: (l) => l.name },
      { header: "Type", value: (l) => l.type },
      { header: money("Budget", ctx), value: (l) => csvMoney(l.budget), numeric: true },
      { header: money("Actual", ctx), value: (l) => csvMoney(l.actual), numeric: true },
      { header: money("Variance", ctx), value: (l) => csvMoney(l.variance), numeric: true },
    ];

    return { filename: rangeFilename("budget-vs-actual", range.from, range.to), body: csvFile(lines, columns) };
  },
};

// ── Document lists ──────────────────────────────────────────────────────────

/**
 * Sales and purchase document lists. These are not "reports", but they are the
 * screens people most often want in a spreadsheet — an accountant chasing
 * receivables works from a list of invoices, not a P&L.
 */
function documentListExport(kind: "invoice" | "bill"): ExportDefinition {
  return {
    capability: kind === "invoice" ? CAPABILITIES.INVOICES : CAPABILITIES.BILLS,
    build: async (ctx) => {
      const status = ctx.params.get("status") ?? "";
      const query = ctx.params.get("q") ?? "";
      const from = ctx.params.get("from");
      const to = ctx.params.get("to");

      const where = {
        companyId: ctx.companyId,
        ...(status ? { status } : {}),
        ...(from || to
          ? { issueDate: { ...(from ? { gte: toUtcDay(from) } : {}), ...(to ? { lte: toUtcDay(to) } : {}) } }
          : {}),
      };

      if (kind === "invoice") {
        const invoices = await db.invoice.findMany({
          where: {
            ...where,
            ...(query ? { OR: [{ number: { contains: query, mode: "insensitive" as const } }, { customer: { name: { contains: query, mode: "insensitive" as const } } }] } : {}),
          },
          include: { customer: { select: { name: true } } },
          orderBy: [{ issueDate: "desc" }, { number: "desc" }],
        });
        type Row = (typeof invoices)[number];
        const columns: CsvColumn<Row>[] = [
          { header: "Invoice number", value: (r) => r.number },
          { header: "Customer", value: (r) => r.customer?.name ?? "" },
          { header: "Issue date", value: (r) => csvDate(r.issueDate) },
          { header: "Due date", value: (r) => csvDate(r.dueDate) },
          { header: "Status", value: (r) => r.status },
          { header: money("Subtotal", ctx), value: (r) => csvMoney(r.subtotalCents), numeric: true },
          { header: money("Tax", ctx), value: (r) => csvMoney(r.taxCents), numeric: true },
          { header: money("Total", ctx), value: (r) => csvMoney(r.totalCents), numeric: true },
          { header: money("Paid", ctx), value: (r) => csvMoney(r.amountPaidCents), numeric: true },
          { header: money("Balance", ctx), value: (r) => csvMoney(r.balanceCents), numeric: true },
        ];
        return { filename: asOfFilename("invoices", today()), body: csvFile(invoices, columns) };
      }

      const bills = await db.bill.findMany({
        where: {
          ...where,
          ...(query ? { OR: [{ number: { contains: query, mode: "insensitive" as const } }, { vendor: { name: { contains: query, mode: "insensitive" as const } } }] } : {}),
        },
        include: { vendor: { select: { name: true } } },
        orderBy: [{ issueDate: "desc" }, { number: "desc" }],
      });
      type Row = (typeof bills)[number];
      const columns: CsvColumn<Row>[] = [
        { header: "Bill number", value: (r) => r.number },
        { header: "Vendor", value: (r) => r.vendor?.name ?? "" },
        { header: "Issue date", value: (r) => csvDate(r.issueDate) },
        { header: "Due date", value: (r) => csvDate(r.dueDate) },
        { header: "Status", value: (r) => r.status },
        { header: money("Subtotal", ctx), value: (r) => csvMoney(r.subtotalCents), numeric: true },
        { header: money("Tax", ctx), value: (r) => csvMoney(r.taxCents), numeric: true },
        { header: money("Total", ctx), value: (r) => csvMoney(r.totalCents), numeric: true },
        { header: money("Paid", ctx), value: (r) => csvMoney(r.amountPaidCents), numeric: true },
        { header: money("Balance", ctx), value: (r) => csvMoney(r.balanceCents), numeric: true },
      ];
      return { filename: asOfFilename("bills", today()), body: csvFile(bills, columns) };
    },
  };
}

const chartOfAccountsExport: ExportDefinition = {
  capability: CAPABILITIES.COA,
  build: async (ctx) => {
    const accounts = await db.account.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { code: "asc" },
      select: { code: true, name: true, type: true, subtype: true, isActive: true, isSystem: true, description: true },
    });
    type Row = (typeof accounts)[number];
    const columns: CsvColumn<Row>[] = [
      { header: "Account code", value: (r) => r.code },
      { header: "Account name", value: (r) => r.name },
      { header: "Type", value: (r) => r.type },
      { header: "Classification", value: (r) => r.subtype },
      { header: "Description", value: (r) => r.description },
      { header: "Active", value: (r) => (r.isActive ? "Yes" : "No") },
      { header: "System account", value: (r) => (r.isSystem ? "Yes" : "No") },
    ];
    return { filename: asOfFilename("chart-of-accounts", today()), body: csvFile(accounts, columns) };
  },
};

const productsServicesExport: ExportDefinition = {
  capability: CAPABILITIES.COMPANY_SETTINGS,
  build: async (ctx) => {
    const items = await db.serviceItem.findMany({
      where: { companyId: ctx.companyId },
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      include: {
        incomeAccount: { select: { code: true, name: true } },
        expenseAccount: { select: { code: true, name: true } },
        taxCode: { select: { code: true } },
        purchaseTaxCode: { select: { code: true } },
      },
    });
    type Row = (typeof items)[number];
    const columns: CsvColumn<Row>[] = [
      { header: "Code", value: (r) => r.code },
      { header: "Name", value: (r) => r.name },
      { header: "Type", value: (r) => r.type },
      { header: "Description", value: (r) => r.description },
      { header: "Unit", value: (r) => r.unit },
      { header: money("List price", ctx), value: (r) => csvMoney(r.unitPriceCents), numeric: true },
      { header: "Default discount (%)", value: (r) => csvRate(r.discountPercentMicro * 100), numeric: true },
      { header: "Sales account", value: (r) => (r.incomeAccount ? `${r.incomeAccount.code} ${r.incomeAccount.name}` : "") },
      { header: "Purchase account", value: (r) => (r.expenseAccount ? `${r.expenseAccount.code} ${r.expenseAccount.name}` : "") },
      { header: "Sales tax code", value: (r) => r.taxCode?.code ?? "" },
      { header: "Purchase tax code", value: (r) => r.purchaseTaxCode?.code ?? "" },
      { header: "Active", value: (r) => (r.isActive ? "Yes" : "No") },
    ];
    return { filename: asOfFilename("products-and-services", today()), body: csvFile(items, columns) };
  },
};

// ── Registry ────────────────────────────────────────────────────────────────

/** Raised by a definition to return a specific HTTP status. */
export class ExportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const EXPORTS: Record<string, ExportDefinition> = {
  "trial-balance": trialBalanceExport,
  "income-statement": incomeStatementExport,
  "profit-and-loss": incomeStatementExport,
  "balance-sheet": balanceSheetExport,
  "cash-flow": cashFlowExport,
  "general-ledger": generalLedgerExport,
  "journal-report": journalReportExport,
  "ar-aging": agingExport("AR"),
  "ap-aging": agingExport("AP"),
  "customer-statement": statementExport("customer"),
  "vendor-statement": statementExport("vendor"),
  "tax-summary": taxSummaryExport,
  "tax-detail": taxDetailExport,
  "budget-vs-actual": budgetVsActualExport,
  invoices: documentListExport("invoice"),
  bills: documentListExport("bill"),
  "chart-of-accounts": chartOfAccountsExport,
  "products-services": productsServicesExport,
};
