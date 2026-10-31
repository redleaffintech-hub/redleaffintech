/**
 * Export data (QuickBooks-style zip): range presets, then a real export of the
 * busiest local company, checked for internal consistency. Local/dev DB only.
 *   npx tsx scripts/verify-export-data.ts [outDir]
 */
import "./load-env";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { resolveRange } from "../src/lib/export-ranges";

let failures = 0;
const check = (n: string, ok: boolean, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + d}`);
  if (!ok) failures++;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const T = new Date(Date.UTC(2026, 9, 28)); // 28 Oct 2026

async function sheetOf(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as never);
  return wb.worksheets[0];
}
const num = (v: unknown) => (typeof v === "number" ? v : 0);
const text = (v: unknown) => String(v ?? "");

async function main() {
  const r = (p: Parameters<typeof resolveRange>[0], fsm = 1) => resolveRange(p, { today: T, fiscalYearStartMonth: fsm });
  check("All dates label", r("ALL").label === "All Dates" && r("ALL").all);
  check("Last calendar quarter of 28 Oct 2026 = Jul 1-Sep 30", `${iso(r("LAST_CALENDAR_QUARTER").from)}..${iso(r("LAST_CALENDAR_QUARTER").to)}` === "2026-07-01..2026-09-30");
  check("This year-to-date = Jan 1..today", iso(r("YTD").from) === "2026-01-01" && iso(r("YTD").to) === "2026-10-28" && r("YTD").label === "January 1-October 28, 2026");
  check("Last year = 2025", iso(r("LAST_YEAR").from) === "2025-01-01" && iso(r("LAST_YEAR").to) === "2025-12-31");
  check("FY starting Apr: fiscal YTD from Apr 1 2026", iso(r("FISCAL_YTD", 4).from) === "2026-04-01");
  check("FY starting Apr: last fiscal year Apr 2025-Mar 2026", iso(r("LAST_FISCAL_YEAR", 4).from) === "2025-04-01" && iso(r("LAST_FISCAL_YEAR", 4).to) === "2026-03-31");
  check("FY starting Apr: last fiscal quarter = Jul 1-Sep 30", iso(r("LAST_FISCAL_QUARTER", 4).from) === "2026-07-01" && iso(r("LAST_FISCAL_QUARTER", 4).to) === "2026-09-30");
  check("FY starting Nov (Oct is its 12th month): last fiscal quarter = May 1-Jul 31", iso(r("LAST_FISCAL_QUARTER", 11).from) === "2026-05-01" && iso(r("LAST_FISCAL_QUARTER", 11).to) === "2026-07-31");
  const jan = resolveRange("LAST_CALENDAR_QUARTER", { today: new Date(Date.UTC(2026, 0, 10)), fiscalYearStartMonth: 1 });
  check("Last calendar quarter in January crosses the year (Oct-Dec 2025)", iso(jan.from) === "2025-10-01" && iso(jan.to) === "2025-12-31");
  let threw = false;
  try { resolveRange("CUSTOM", { today: T, fiscalYearStartMonth: 1, customFrom: "2026-05-01", customTo: "2026-04-01" }); } catch { threw = true; }
  check("custom range with from>to is rejected", threw);

  if (/neon\.tech/.test(process.env.DATABASE_URL ?? "")) {
    console.log("SKIP  data export (DATABASE_URL is Neon/production)");
    process.exit(failures ? 1 : 0);
  }

  const { db } = await import("../src/lib/db");
  const { buildExportZip, EXPORT_ITEMS } = await import("../src/server/exports/quickbooks-style");
  const top = await db.journalLine.groupBy({ by: ["companyId"], _count: true, orderBy: { _count: { companyId: "desc" } }, take: 1 });
  if (!top[0]) throw new Error("No journal data in the local database.");
  const co = await db.company.findUniqueOrThrow({ where: { id: top[0].companyId }, select: { id: true, name: true } });
  console.log(`company: ${co.name} (${top[0]._count} journal lines)`);

  const out = await buildExportZip({ companyId: co.id, companyName: co.name, range: r("ALL"), items: EXPORT_ITEMS.map((i) => i.key) });
  const dir = process.argv[2];
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, out.filename), out.bytes);
  }
  const files = unzipSync(out.bytes);
  check("zip holds the 8 QuickBooks file names", EXPORT_ITEMS.every((i) => i.file in files), Object.keys(files).join());
  check("zip is named '<Company> <Mon D, YYYY>.zip'", /^.+ [A-Z][a-z]{2} \d{1,2}, \d{4}\.zip$/.test(out.filename), out.filename);

  const tb = await sheetOf(files["Trial_balance.xlsx"]);
  let td = 0, tc = 0;
  let tbTotal: [number, number] = [0, 0];
  tb.eachRow((row, i) => {
    if (i < 6) return;
    const a = row.getCell(1).value;
    if (a === "TOTAL") tbTotal = [num(row.getCell(2).value), num(row.getCell(3).value)];
    else if (typeof a === "string" && !a.includes(" - Accrual")) { td += num(row.getCell(2).value); tc += num(row.getCell(3).value); }
  });
  check("trial balance: debits = credits", Math.abs(tbTotal[0] - tbTotal[1]) < 0.005 && tbTotal[0] > 0, JSON.stringify(tbTotal));
  check("trial balance: TOTAL row equals the sum of its rows", Math.abs(td - tbTotal[0]) < 0.01 && Math.abs(tc - tbTotal[1]) < 0.01, `${td}/${tc}`);
  check("header block: company / title / date line", tb.getCell("A1").value === co.name && tb.getCell("A2").value === "Trial Balance" && tb.getCell("A3").value === "All Dates");

  const j = await sheetOf(files["Journal.xlsx"]);
  let jt: [number, number] = [0, 0];
  j.eachRow((row) => { if (row.getCell(1).value === "TOTAL") jt = [num(row.getCell(8).value), num(row.getCell(9).value)]; });
  const agg = await db.journalLine.aggregate({ where: { companyId: co.id }, _sum: { debitCents: true, creditCents: true } });
  check("journal: TOTAL debits = credits = the ledger's gross debits", Math.abs(jt[0] - jt[1]) < 0.005 && Math.abs(jt[0] * 100 - (agg._sum.debitCents ?? 0)) < 1, `${jt} vs ${agg._sum.debitCents}`);

  const bs = await sheetOf(files["Balance_sheet.xlsx"]);
  const val = (ws: ExcelJS.Worksheet, label: string) => { let v = NaN; ws.eachRow((row) => { if (row.getCell(1).value === label) v = num(row.getCell(2).value); }); return v; };
  const assets = val(bs, "Total Assets");
  const le = val(bs, "Total Liabilities and Equity");
  check("balance sheet: assets = liabilities + equity", Math.abs(assets - le) < 0.005 && assets !== 0, `${assets} vs ${le}`);

  const pl = await sheetOf(files["Profit_and_loss.xlsx"]);
  let profit = NaN, bsProfit = NaN;
  pl.eachRow((row) => { if (row.getCell(1).value === "PROFIT") profit = num(row.getCell(2).value); });
  bs.eachRow((row) => { if (text(row.getCell(1).value).trim() === "Profit for the year") bsProfit = num(row.getCell(2).value); });
  check("P&L PROFIT = balance sheet 'Profit for the year' (all dates)", Math.abs(profit - bsProfit) < 0.005, `${profit} vs ${bsProfit}`);

  const gl = await sheetOf(files["General_ledger.xlsx"]);
  let glRows = 0, glHeaders = 0, glDebits = 0, glCredits = 0;
  gl.eachRow((row, i) => {
    if (i < 6) return;
    const a = text(row.getCell(1).value);
    if (a.includes(" - Accrual")) return; // merged footer: every cell of the row reads back as its text
    if (row.getCell(2).value) { glRows++; glDebits += num(row.getCell(8).value); glCredits += num(row.getCell(9).value); }
    else if (a && !a.startsWith("Total for") && !a.includes(" - Accrual")) glHeaders++;
  });
  check("GL: grouped by account, debits = credits over all rows", glHeaders > 0 && glRows > 0 && Math.abs(glDebits - glCredits) < 0.01, `${glHeaders} accounts, ${glRows} rows, ${glDebits}/${glCredits}`);
  check("GL line count = journal line count", glRows === top[0]._count, `${glRows} vs ${top[0]._count}`);

  const cu = await sheetOf(files["Customers.xlsx"]);
  check("customers list has the QuickBooks columns", ["Customer", "Phone Numbers", "Email", "Full Name", "Billing Address", "Shipping Address"].every((h, k) => cu.getRow(5).getCell(k + 2).value === h));
  const su = await sheetOf(files["Suppliers.xlsx"]);
  check("suppliers list has the QuickBooks columns", ["Supplier", "Phone Numbers", "Email", "Full Name", "Address", "Account #"].every((h, k) => su.getRow(5).getCell(k + 2).value === h));
  const rng = await buildExportZip({ companyId: co.id, companyName: co.name, range: r("LAST_YEAR"), items: ["GENERAL_LEDGER", "TRIAL_BALANCE"] });
  check("a ranged export builds only the chosen files", Object.keys(unzipSync(rng.bytes)).sort().join() === "General_ledger.xlsx,Trial_balance.xlsx");

  console.log(failures ? `\n${failures} FAILED` : "\nAll export-data checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
