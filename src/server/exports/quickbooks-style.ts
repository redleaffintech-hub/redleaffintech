import "server-only";
import ExcelJS from "exceljs";
import { zipSync } from "fflate";
import { db } from "@/lib/db";
import { INCOME_STATEMENT_SUBTYPES, NORMAL_BALANCE, subtypeLabel, type AccountType } from "@/lib/enums";
import type { ResolvedRange } from "@/lib/export-ranges";
import { balanceSheet, generalLedger, trialBalance } from "@/server/reports/financials";

/**
 * "Export data" in the layout accountants know from QuickBooks Online: one .xlsx
 * per report or list, bundled in a zip — the same files, sheet names, column
 * order and header block (company, report title, date line) — so a file can be
 * handed to an accountant, an auditor or another system that already expects
 * that shape. Every figure comes from the same report functions the screens use,
 * so an export can never disagree with what the user sees.
 */

export const EXPORT_ITEMS = [
  { key: "GENERAL_LEDGER", kind: "report", label: "General ledger", file: "General_ledger.xlsx" },
  { key: "PROFIT_AND_LOSS", kind: "report", label: "Profit and loss", file: "Profit_and_loss.xlsx" },
  { key: "BALANCE_SHEET", kind: "report", label: "Balance sheet", file: "Balance_sheet.xlsx" },
  { key: "TRIAL_BALANCE", kind: "report", label: "Trial balance", file: "Trial_balance.xlsx" },
  { key: "JOURNAL", kind: "report", label: "Journal", file: "Journal.xlsx" },
  { key: "CUSTOMERS", kind: "list", label: "Customers", file: "Customers.xlsx" },
  { key: "EMPLOYEES", kind: "list", label: "Employees", file: "Employees.xlsx" },
  { key: "SUPPLIERS", kind: "list", label: "Suppliers", file: "Suppliers.xlsx" },
] as const;

export type ExportKey = (typeof EXPORT_ITEMS)[number]["key"];
export const isExportKey = (v: string): v is ExportKey => EXPORT_ITEMS.some((i) => i.key === v);

export interface ExportRequest {
  companyId: string;
  companyName: string;
  range: ResolvedRange;
  items: ExportKey[];
  now?: Date;
}

// ───────────────────────── formatting helpers ─────────────────────────

const MONEY = "#,##0.00";
const TOTAL = '"$"* #,##0.00';
const TZ = "America/Toronto";
const MON = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

/** "Wednesday, Oct. 28, 2026 07:17:35 p.m. GMT-7" — QuickBooks' footer. */
function stamp(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, weekday: "long", year: "numeric", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZoneName: "shortOffset",
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const ampm = String(parts.dayPeriod ?? "").toLowerCase().startsWith("p") ? "p.m." : "a.m.";
  return `${parts.weekday}, ${MON[Number(parts.month) - 1]} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} ${ampm} ${parts.timeZoneName}`;
}

const dmy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const money = (cents: number) => cents / 100;

const SOURCE_LABEL: Record<string, string> = {
  INVOICE: "Invoice", BILL: "Bill", PAYMENT: "Payment", EXPENSE: "Expense", CREDIT_NOTE: "Credit Note",
  BANK: "Bank Transaction", OPENING: "Opening Balance", CLOSING: "Closing Entry", DEPRECIATION: "Depreciation",
  PAY_RUN: "Payroll", FIXED_ASSET: "Fixed Asset", COST_ADJUSTMENT: "Cost Adjustment", ADJUSTMENT: "Journal Entry",
  MANUAL: "Journal Entry",
};
const sourceLabel = (t: string) => SOURCE_LABEL[t] ?? "Journal Entry";

interface Sheet {
  wb: ExcelJS.Workbook;
  ws: ExcelJS.Worksheet;
  cols: number;
  next: number; // next free row
}

function startSheet(opts: { sheetName: string; title: string; subtitle: string; company: string; widths: number[] }): Sheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts.sheetName);
  const cols = opts.widths.length;
  opts.widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  [opts.company, opts.title, opts.subtitle].forEach((text, i) => {
    const r = ws.getRow(i + 1);
    r.getCell(1).value = text;
    r.font = { bold: true };
    ws.mergeCells(i + 1, 1, i + 1, cols);
  });
  return { wb, ws, cols, next: 5 };
}

function headerRow(s: Sheet, labels: Record<number, string>) {
  const row = s.ws.getRow(s.next++);
  for (const [col, label] of Object.entries(labels)) row.getCell(Number(col)).value = label;
  row.font = { bold: true };
}

function footer(s: Sheet, text: string) {
  s.next += 2;
  const row = s.ws.getRow(s.next);
  row.getCell(1).value = text;
  s.ws.mergeCells(s.next, 1, s.next, s.cols);
  s.next++;
}

function put(s: Sheet, cells: Record<number, string | number | null | undefined>, opts: { bold?: boolean; money?: number[]; total?: number[] } = {}) {
  const row = s.ws.getRow(s.next++);
  for (const [col, value] of Object.entries(cells)) {
    if (value === null || value === undefined || value === "") continue;
    const cell = row.getCell(Number(col));
    cell.value = value;
    if (opts.money?.includes(Number(col))) cell.numFmt = MONEY;
    if (opts.total?.includes(Number(col))) cell.numFmt = TOTAL;
  }
  if (opts.bold) row.font = { bold: true };
  return row;
}

const blank = (s: Sheet) => void s.next++;
const toBytes = async (wb: ExcelJS.Workbook) => new Uint8Array(await wb.xlsx.writeBuffer());
const indent = (n: number, text: string) => " ".repeat(n) + text;

// ───────────────────────── reports ─────────────────────────

async function generalLedgerFile(r: ExportRequest, now: Date) {
  const s = startSheet({
    sheetName: "General Ledger", title: "General Ledger", subtitle: r.range.label, company: r.companyName,
    widths: [35.2, 11, 17.2, 16.3, 19.8, 57.6, 37.8, 12, 12, 12],
  });
  headerRow(s, { 2: "Date", 3: "Transaction Type", 4: "#", 5: "Name", 6: "Memo/Description", 7: "Account", 8: "Debit", 9: "Credit", 10: "Balance" });

  const groups = await generalLedger(r.companyId, { from: r.range.from, to: r.range.to }, { limit: 500_000 });
  for (const g of groups) {
    put(s, { 1: g.account.name }, { bold: true });
    if (!r.range.all && g.openingBalanceCents !== 0) {
      put(s, { 6: "Beginning Balance", 7: g.account.name, 10: money(g.openingBalanceCents) }, { money: [10] });
    }
    for (const line of g.rows) {
      put(
        s,
        {
          2: dmy(line.date),
          3: sourceLabel(line.journalEntry.sourceType),
          4: line.journalEntry.sourceNumber ?? line.journalEntry.entryNo,
          5: line.customer?.name ?? line.vendor?.name ?? null,
          6: line.description ?? line.journalEntry.memo ?? null,
          7: g.account.name,
          8: line.debitCents ? money(line.debitCents) : null,
          9: line.creditCents ? money(line.creditCents) : null,
          10: money(line.runningBalanceCents),
        },
        { money: [8, 9, 10] },
      );
    }
    // QuickBooks puts the closing balance in the Debit column of the total row.
    put(s, { 1: `Total for ${g.account.name}`, 8: money(g.closingBalanceCents) }, { bold: true, total: [8] });
  }
  footer(s, `${stamp(now)} - Accrual Basis`);
  return toBytes(s.wb);
}

async function journalFile(r: ExportRequest, now: Date) {
  const s = startSheet({
    sheetName: "Journal", title: "Journal", subtitle: r.range.label, company: r.companyName,
    widths: [7.7, 11, 17.2, 16.3, 19.8, 57.6, 37.8, 12, 12],
  });
  headerRow(s, { 2: "Date", 3: "Transaction Type", 4: "#", 5: "Name", 6: "Memo/Description", 7: "Account", 8: "Debit", 9: "Credit" });

  const entries = await db.journalEntry.findMany({
    where: { companyId: r.companyId, date: { gte: r.range.from, lte: r.range.to } },
    orderBy: [{ date: "asc" }, { entryNo: "asc" }],
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: { account: { select: { name: true } }, customer: { select: { name: true } }, vendor: { select: { name: true } } },
      },
    },
  });

  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of entries) {
    let debit = 0;
    let credit = 0;
    entry.lines.forEach((line, i) => {
      debit += line.debitCents;
      credit += line.creditCents;
      const first = i === 0;
      const memo = first ? (line.description ?? entry.memo) : line.description && line.description !== entry.memo ? line.description : null;
      put(
        s,
        {
          2: first ? dmy(entry.date) : null,
          3: first ? sourceLabel(entry.sourceType) : null,
          4: first ? (entry.sourceNumber ?? entry.entryNo) : null,
          5: first ? (line.customer?.name ?? line.vendor?.name ?? null) : null,
          6: memo,
          7: line.account.name,
          8: line.debitCents ? money(line.debitCents) : null,
          9: line.creditCents ? money(line.creditCents) : null,
        },
        { money: [8, 9] },
      );
    });
    put(s, { 8: money(debit), 9: money(credit) }, { bold: true, total: [8, 9] });
    blank(s);
    totalDebit += debit;
    totalCredit += credit;
  }
  put(s, { 1: "TOTAL", 8: money(totalDebit), 9: money(totalCredit) }, { bold: true, total: [8, 9] });
  footer(s, stamp(now));
  return toBytes(s.wb);
}

async function trialBalanceFile(r: ExportRequest, now: Date) {
  const s = startSheet({
    sheetName: "Trial Balance", title: "Trial Balance", subtitle: r.range.label, company: r.companyName,
    widths: [37.8, 14, 14],
  });
  headerRow(s, { 2: "Debit", 3: "Credit" });

  const tb = await trialBalance(r.companyId, { from: r.range.from, to: r.range.to });
  let totalDebit = 0;
  let totalCredit = 0;
  for (const row of tb.rows) {
    // Balance-sheet accounts carry forward; income and expense accounts show only the period.
    const isPeriodAccount = row.type === "REVENUE" || row.type === "EXPENSE";
    const natural = isPeriodAccount ? row.periodDebitCents - row.periodCreditCents : row.closingCents * (NORMAL_BALANCE[row.type as AccountType] === "DEBIT" ? 1 : -1);
    if (isPeriodAccount && row.periodDebitCents === 0 && row.periodCreditCents === 0) continue;
    const debit = Math.max(natural, 0);
    const credit = Math.max(-natural, 0);
    totalDebit += debit;
    totalCredit += credit;
    put(s, { 1: row.name, 2: money(debit), 3: money(credit) }, { bold: false, money: [2, 3] }).getCell(1).font = { bold: true };
  }
  put(s, { 1: "TOTAL", 2: money(totalDebit), 3: money(totalCredit) }, { bold: true, total: [2, 3] });
  footer(s, `${stamp(now)} - Accrual Basis`);
  return toBytes(s.wb);
}

async function profitAndLossFile(r: ExportRequest, now: Date) {
  const s = startSheet({
    sheetName: "Profit and Loss", title: "Profit and Loss", subtitle: r.range.label, company: r.companyName,
    widths: [34, 16],
  });
  headerRow(s, { 2: "Total" });

  const tb = await trialBalance(r.companyId, { from: r.range.from, to: r.range.to });
  const cogs: readonly string[] = INCOME_STATEMENT_SUBTYPES.MATERIAL_EXPENSE;
  const otherIncome: readonly string[] = [...INCOME_STATEMENT_SUBTYPES.INTEREST_INCOME, ...INCOME_STATEMENT_SUBTYPES.OTHER_INCOME];
  const otherExpense: readonly string[] = [...INCOME_STATEMENT_SUBTYPES.INTEREST_EXPENSE, ...INCOME_STATEMENT_SUBTYPES.OTHER_EXPENSE];

  const active = tb.rows.filter((x) => x.periodDebitCents !== 0 || x.periodCreditCents !== 0);
  const rev = (x: (typeof active)[number]) => x.periodCreditCents - x.periodDebitCents;
  const exp = (x: (typeof active)[number]) => x.periodDebitCents - x.periodCreditCents;
  const income = active.filter((x) => x.type === "REVENUE" && !otherIncome.includes(x.subtype));
  const cost = active.filter((x) => x.type === "EXPENSE" && cogs.includes(x.subtype));
  const expenses = active.filter((x) => x.type === "EXPENSE" && !cogs.includes(x.subtype) && !otherExpense.includes(x.subtype));
  const oIncome = active.filter((x) => x.type === "REVENUE" && otherIncome.includes(x.subtype));
  const oExpense = active.filter((x) => x.type === "EXPENSE" && otherExpense.includes(x.subtype));
  const sum = (rows: typeof active, f: (x: (typeof active)[number]) => number) => rows.reduce((t, x) => t + f(x), 0);

  const section = (title: string | null, rows: typeof active, f: (x: (typeof active)[number]) => number, totalLabel: string) => {
    if (title) put(s, { 1: title }, { bold: true });
    for (const x of rows) put(s, { 1: indent(3, x.name), 2: money(f(x)) }, { money: [2] }).getCell(1).font = { bold: true };
    const total = sum(rows, f);
    put(s, { 1: totalLabel, 2: money(total) }, { bold: true, total: [2] });
    return total;
  };

  const totalIncome = section(indent(0, "INCOME"), income, rev, indent(3, "Total Income"));
  const totalCost = cost.length ? section("COST OF GOODS SOLD", cost, exp, indent(3, "Total Cost of Goods Sold")) : 0;
  const grossProfit = totalIncome - totalCost;
  put(s, { 1: "GROSS PROFIT", 2: money(grossProfit) }, { bold: true, total: [2] });
  const totalExpenses = section("EXPENSES", expenses, exp, "Total Expenses");
  let profit = grossProfit - totalExpenses;
  if (oIncome.length) profit += section("OTHER INCOME", oIncome, rev, indent(3, "Total Other Income"));
  if (oExpense.length) profit -= section("OTHER EXPENSES", oExpense, exp, indent(3, "Total Other Expenses"));
  put(s, { 1: "PROFIT", 2: money(profit) }, { bold: true, total: [2] });
  footer(s, `${stamp(now)} - Accrual Basis`);
  return toBytes(s.wb);
}

async function balanceSheetFile(r: ExportRequest, now: Date) {
  const s = startSheet({
    sheetName: "Balance Sheet", title: "Balance Sheet", subtitle: r.range.label, company: r.companyName,
    widths: [40, 16],
  });
  headerRow(s, { 2: "Total" });

  const bs = await balanceSheet(r.companyId, r.range.to);
  const sec = (key: string) => bs.sections.find((x) => x.key === key)!;

  /** Accounts of one section, grouped by subtype the way QuickBooks nests them. */
  const renderSection = (key: string, title: string, level: number) => {
    const section = sec(key);
    put(s, { 1: indent(level, title) }, { bold: true });
    const bySubtype = new Map<string, typeof section.rows>();
    for (const row of section.rows) bySubtype.set(row.subtype, [...(bySubtype.get(row.subtype) ?? []), row]);
    for (const [subtype, rows] of bySubtype) {
      if (rows.length === 1) {
        put(s, { 1: indent(level + 3, rows[0].name), 2: money(rows[0].balanceCents) }, { money: [2] }).getCell(1).font = { bold: true };
      } else {
        put(s, { 1: indent(level + 3, subtypeLabel(subtype)) }, { bold: true });
        for (const row of rows) put(s, { 1: indent(level + 6, row.name), 2: money(row.balanceCents) }, { money: [2] }).getCell(1).font = { bold: true };
        put(s, { 1: indent(level + 3, `Total ${subtypeLabel(subtype)}`), 2: money(rows.reduce((t, x) => t + x.balanceCents, 0)) }, { bold: true, total: [2] });
      }
    }
    put(s, { 1: indent(level, `Total ${title}`), 2: money(section.totalCents) }, { bold: true, total: [2] });
    return section;
  };

  put(s, { 1: "Assets" }, { bold: true });
  renderSection("CURRENT_ASSETS", "Current Assets", 3);
  if (sec("FIXED_ASSETS").rows.length) renderSection("FIXED_ASSETS", "Fixed Assets", 3);
  put(s, { 1: "Total Assets", 2: money(bs.totalAssetsCents) }, { bold: true, total: [2] });

  put(s, { 1: "Liabilities and Equity" }, { bold: true });
  put(s, { 1: indent(3, "Liabilities") }, { bold: true });
  renderSection("CURRENT_LIABILITIES", "Current Liabilities", 6);
  if (sec("LONG_TERM_LIABILITIES").rows.length) renderSection("LONG_TERM_LIABILITIES", "Long-term Liabilities", 6);
  put(s, { 1: indent(3, "Total Liabilities"), 2: money(bs.totalLiabilitiesCents) }, { bold: true, total: [2] });

  put(s, { 1: indent(3, "Equity") }, { bold: true });
  for (const row of sec("EQUITY").rows) put(s, { 1: indent(6, row.name), 2: money(row.balanceCents) }, { money: [2] }).getCell(1).font = { bold: true };
  put(s, { 1: indent(6, "Profit for the year"), 2: money(bs.currentEarningsCents) }, { money: [2] }).getCell(1).font = { bold: true };
  put(s, { 1: indent(3, "Total Equity"), 2: money(bs.totalEquityCents) }, { bold: true, total: [2] });
  put(s, { 1: "Total Liabilities and Equity", 2: money(bs.totalLiabilitiesAndEquityCents) }, { bold: true, total: [2] });
  footer(s, `${stamp(now)} - Accrual Basis`);
  return toBytes(s.wb);
}

// ───────────────────────── lists ─────────────────────────

const COUNTRY: Record<string, string> = { CA: "Canada", US: "United States" };

function address(p: {
  line1?: string | null; line2?: string | null; city?: string | null; province?: string | null; postalCode?: string | null; country?: string | null;
}): string | null {
  const region = [p.city, p.province, p.postalCode].filter(Boolean).join(" ");
  const lines = [p.line1, p.line2, region, p.country && (COUNTRY[p.country] ?? p.country)].filter(Boolean) as string[];
  // A country on its own is the default filled in on every record, not an address.
  if (lines.length <= 1 && !p.line1 && !region) return null;
  return lines.join("\n");
}

async function listFile(
  r: ExportRequest, now: Date,
  def: { sheetName: string; title: string; widths: number[]; headers: Record<number, string>; rows: Record<number, string | null | undefined>[] },
) {
  const s = startSheet({ sheetName: def.sheetName, title: def.title, subtitle: "", company: r.companyName, widths: def.widths });
  headerRow(s, def.headers);
  if (def.rows.length === 0) {
    blank(s);
    const row = s.ws.getRow(s.next);
    row.getCell(1).value = "This report contains no data.";
    s.ws.mergeCells(s.next, 1, s.next, s.cols);
    s.next += 2;
    const f = s.ws.getRow(s.next);
    f.getCell(1).value = stamp(now);
    s.ws.mergeCells(s.next, 1, s.next, s.cols);
  } else {
    for (const row of def.rows) {
      const r2 = put(s, row);
      r2.eachCell((c) => { if (typeof c.value === "string" && c.value.includes("\n")) c.alignment = { wrapText: true, vertical: "top" }; });
    }
    footer(s, stamp(now));
  }
  return toBytes(s.wb);
}

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

async function customersFile(r: ExportRequest, now: Date) {
  const rows = await db.customer.findMany({
    where: { companyId: r.companyId },
    include: { contacts: { orderBy: { isPrimary: "desc" }, take: 1, select: { name: true } } },
  });
  return listFile(r, now, {
    sheetName: "Customer Contact List", title: "Customer Contact List",
    widths: [7.7, 30, 16, 28, 22, 34, 34],
    headers: { 2: "Customer", 3: "Phone Numbers", 4: "Email", 5: "Full Name", 6: "Billing Address", 7: "Shipping Address" },
    rows: rows.sort((a, b) => byName(a.name, b.name)).map((c) => ({
      2: c.name, 3: c.phone, 4: c.email, 5: c.contacts[0]?.name,
      6: address({ line1: c.addressLine1, line2: c.addressLine2, city: c.city, province: c.province, postalCode: c.postalCode, country: c.country }),
      7: address({ line1: c.shipToLine1, line2: c.shipToLine2, city: c.shipToCity, province: c.shipToProvince, postalCode: c.shipToPostalCode, country: c.shipToCountry }),
    })),
  });
}

async function suppliersFile(r: ExportRequest, now: Date) {
  const rows = await db.vendor.findMany({
    where: { companyId: r.companyId },
    include: { contacts: { orderBy: { isPrimary: "desc" }, take: 1, select: { name: true } } },
  });
  return listFile(r, now, {
    sheetName: "Supplier Contact List", title: "Supplier Contact List",
    widths: [7.7, 30, 16, 28, 22, 34, 14],
    headers: { 2: "Supplier", 3: "Phone Numbers", 4: "Email", 5: "Full Name", 6: "Address", 7: "Account #" },
    rows: rows.sort((a, b) => byName(a.name, b.name)).map((v) => ({
      2: v.name, 3: v.phone, 4: v.email, 5: v.contacts[0]?.name,
      6: address({ line1: v.addressLine1, city: v.city, province: v.province, postalCode: v.postalCode, country: v.country }),
    })),
  });
}

async function employeesFile(r: ExportRequest, now: Date) {
  const rows = await db.employee.findMany({ where: { companyId: r.companyId } });
  return listFile(r, now, {
    sheetName: "Employee Contact List", title: "Employee Contact List",
    widths: [14, 30, 16, 28, 34],
    headers: { 2: "Employee", 3: "Phone Numbers", 4: "Email", 5: "Address" },
    rows: rows
      .map((e) => ({ name: `${e.legalFirstName} ${e.legalLastName}`.trim(), e }))
      .sort((a, b) => byName(a.name, b.name))
      .map(({ name, e }) => ({
        2: name, 3: e.personalPhone, 4: e.personalEmail,
        5: address({ line1: e.addressLine1, line2: e.addressLine2, city: e.city, province: e.province, postalCode: e.postalCode, country: e.country }),
      })),
  });
}

// ───────────────────────── bundle ─────────────────────────

const BUILDERS: Record<ExportKey, (r: ExportRequest, now: Date) => Promise<Uint8Array>> = {
  GENERAL_LEDGER: generalLedgerFile,
  PROFIT_AND_LOSS: profitAndLossFile,
  BALANCE_SHEET: balanceSheetFile,
  TRIAL_BALANCE: trialBalanceFile,
  JOURNAL: journalFile,
  CUSTOMERS: customersFile,
  EMPLOYEES: employeesFile,
  SUPPLIERS: suppliersFile,
};

/** "The Car Boys Inc. Oct 28, 2026.zip" — the name QuickBooks gives its export. */
export function exportZipName(companyName: string, now: Date): string {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }).format(now);
  return `${companyName.replace(/[\\/:*?"<>|]/g, "").trim() || "Export"} ${d}.zip`;
}

export async function buildExportZip(r: ExportRequest): Promise<{ filename: string; bytes: Uint8Array; files: string[] }> {
  const now = r.now ?? new Date();
  const files: Record<string, Uint8Array> = {};
  for (const item of EXPORT_ITEMS) {
    if (r.items.includes(item.key)) files[item.file] = await BUILDERS[item.key](r, now);
  }
  return { filename: exportZipName(r.companyName, now), bytes: zipSync(files, { level: 6 }), files: Object.keys(files) };
}
