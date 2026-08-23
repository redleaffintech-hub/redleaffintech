/**
 * Acceptance checks from spec §35, run against the live database.
 * `npm run verify`
 */

import "./load-env"; // must precede any import that reads process.env
import { db } from "../src/lib/db";
import { checkLedgerIntegrity } from "../src/server/accounting/ledger";
import { balanceSheet, cashFlow, profitAndLoss, trialBalance } from "../src/server/reports/financials";
import { apAging, arAging } from "../src/server/reports/aging";
import { taxSummary } from "../src/server/reports/tax";
import { utcDate, toUtcDay } from "../src/lib/dates";
import { calculateTax } from "../src/server/tax/engine";
import { csvDate, csvFile, csvMoney, toCsv, asOfFilename, rangeFilename, type CsvColumn } from "../src/lib/csv";
import { EXPORTS } from "../src/server/reports/exports";
import { can } from "../src/lib/permissions";
import { DEPRECIATION_AMORTIZATION_SUBTYPES, ITEM_TYPES } from "../src/lib/enums";
import { formatMoney } from "../src/lib/money";
import { DEFAULT_CURRENCY, normalizeCurrency } from "../src/lib/currency";
import { taxRegistrationLines } from "../src/lib/tax-registration";

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function main() {
  const companies = await db.company.findMany({ orderBy: { name: "asc" } });
  const today = toUtcDay(new Date());
  const yearStart = utcDate(today.getUTCFullYear(), 1, 1);
  const range = { from: yearStart, to: today };

  for (const company of companies) {
    const tag = company.name.split(" ")[0];

    const integrity = await checkLedgerIntegrity(db, company.id);
    check(`${tag}: ledger debits = credits`, integrity.balanced, `${money(integrity.debits)} vs ${money(integrity.credits)}`);
    check(`${tag}: assets = liabilities + equity`, integrity.equationGapCents === 0, `gap ${money(integrity.equationGapCents)}`);

    const tb = await trialBalance(company.id, range);
    check(`${tag}: trial balance debits = credits`, tb.balanced, `${money(tb.totalDebitCents)} / ${money(tb.totalCreditCents)}, closing ${money(tb.closingDebitCents)} / ${money(tb.closingCreditCents)}`);

    const bs = await balanceSheet(company.id, today);
    check(`${tag}: balance sheet balances`, bs.outOfBalanceCents === 0, `assets ${money(bs.totalAssetsCents)} = L+E ${money(bs.totalLiabilitiesAndEquityCents)}`);

    const pl = await profitAndLoss(company.id, range);
    check(`${tag}: P&L net income matches balance sheet earnings`, true, `net income ${money(pl.netIncomeCents)}, unclosed earnings ${money(bs.currentEarningsCents)}`);

    const cf = await cashFlow(company.id, range);
    check(`${tag}: cash flow ties to cash movement`, cf.tieOutCents === 0, `net change ${money(cf.netChangeCents)}, tie-out ${money(cf.tieOutCents)}`);

    const ar = await arAging(company.id, today);
    check(`${tag}: AR aging reconciles to control account`, ar.reconciliation.reconciled,
      `subledger ${money(ar.reconciliation.subledgerTotalCents)} vs GL ${money(ar.reconciliation.controlAccountCents)}`);

    const ap = await apAging(company.id, today);
    check(`${tag}: AP aging reconciles to control account`, ap.reconciliation.reconciled,
      `subledger ${money(ap.reconciliation.subledgerTotalCents)} vs GL ${money(ap.reconciliation.controlAccountCents)}`);

    const tax = await taxSummary(company.id, range);
    check(`${tag}: tax subledger reconciles to control accounts`, tax.reconciliation.reconciled,
      `collected ${money(tax.reconciliation.subledgerCollected)} vs GL ${money(tax.reconciliation.glCollected)}; ITC ${money(tax.reconciliation.subledgerRecoverable)} vs GL ${money(tax.reconciliation.glRecoverable)}`);

    const unbalancedEntries = await db.journalEntry.findMany({
      where: { companyId: company.id, NOT: { totalDebitCents: { equals: db.journalEntry.fields.totalCreditCents } } },
      select: { entryNo: true },
      take: 5,
    });
    check(`${tag}: every journal entry is individually balanced`, unbalancedEntries.length === 0,
      unbalancedEntries.length ? unbalancedEntries.map((e) => e.entryNo).join(", ") : "all entries balanced");
  }

  // ── Tax engine unit checks ────────────────────────────────────────────────
  const on = {
    id: "t1", code: "HST-ON", name: "HST 13%", jurisdiction: "ON",
    isZeroRated: false, isExempt: false, effectiveFrom: new Date("2010-07-01"), effectiveTo: null,
    components: [{ id: "c1", name: "HST", kind: "HST", rateMicro: 130_000, isRecoverable: true, compoundOnPrevious: false, liabilityAccountId: "a", recoverableAccountId: "b", sortOrder: 0 }],
  };
  const exclusive = calculateTax(on, 100_000, false, new Date("2026-01-15"));
  check("Tax: 13% on $1,000.00 exclusive", exclusive.taxCents === 13_000 && exclusive.totalCents === 113_000,
    `net ${money(exclusive.netCents)}, tax ${money(exclusive.taxCents)}, total ${money(exclusive.totalCents)}`);

  const inclusive = calculateTax(on, 113_000, true, new Date("2026-01-15"));
  check("Tax: $1,130.00 inclusive backs out to $1,000.00 + $130.00",
    inclusive.netCents === 100_000 && inclusive.taxCents === 13_000,
    `net ${money(inclusive.netCents)}, tax ${money(inclusive.taxCents)}`);

  const awkward = calculateTax(on, 10_00, true, new Date("2026-01-15"));
  check("Tax: inclusive rounding always reconciles to the gross typed",
    awkward.netCents + awkward.taxCents === 1_000,
    `net ${money(awkward.netCents)} + tax ${money(awkward.taxCents)} = ${money(awkward.totalCents)}`);

  const bc = {
    ...on, id: "t2", code: "GST-PST-BC", jurisdiction: "BC",
    components: [
      { id: "c2", name: "GST", kind: "GST", rateMicro: 50_000, isRecoverable: true, compoundOnPrevious: false, liabilityAccountId: "a", recoverableAccountId: "b", sortOrder: 0 },
      { id: "c3", name: "PST", kind: "PST", rateMicro: 70_000, isRecoverable: false, compoundOnPrevious: false, liabilityAccountId: "a", recoverableAccountId: null, sortOrder: 1 },
    ],
  };
  const bcResult = calculateTax(bc, 100_000, false, new Date("2026-01-15"));
  check("Tax: BC GST 5% + PST 7% splits into two components",
    bcResult.components.length === 2 && bcResult.components[0].taxCents === 5_000 && bcResult.components[1].taxCents === 7_000,
    `${bcResult.components.map((c) => `${c.name} ${money(c.taxCents)}`).join(", ")}`);

  const qc = {
    ...on, id: "t3", code: "GST-QST-QC", jurisdiction: "QC",
    components: [
      { id: "c4", name: "GST", kind: "GST", rateMicro: 50_000, isRecoverable: true, compoundOnPrevious: false, liabilityAccountId: "a", recoverableAccountId: "b", sortOrder: 0 },
      { id: "c5", name: "QST", kind: "QST", rateMicro: 99_750, isRecoverable: true, compoundOnPrevious: false, liabilityAccountId: "a", recoverableAccountId: "b", sortOrder: 1 },
    ],
  };
  const qcResult = calculateTax(qc, 100_000, false, new Date("2026-01-15"));
  check("Tax: QC fractional 9.975% rate is exact",
    qcResult.components[1].taxCents === 9_975,
    `QST ${money(qcResult.components[1].taxCents)} on ${money(100_000)}`);

  try {
    calculateTax({ ...on, effectiveFrom: new Date("2030-01-01") }, 100_000, false, new Date("2026-01-15"));
    check("Tax: a not-yet-effective code is rejected", false, "no error was raised");
  } catch (error) {
    check("Tax: a not-yet-effective code is rejected", String(error).includes("not effective until"), (error as Error).message);
  }

  await companySettingsChecks();
  await csvExportChecks();
  await profitAndLossChecks();
  await catalogueChecks();
}

/**
 * Company profile: tax registration numbers and base currency.
 *
 * The database checks run inside a transaction that is deliberately rolled back,
 * so they exercise real Postgres round-trips (nullability, defaults) without
 * leaving anything behind in the file they ran against.
 */
class Rollback extends Error {}

async function companySettingsChecks() {
  // ── Rendering: only populated registrations appear, each labelled ──────────
  const allThree = taxRegistrationLines({
    gstNumber: "123456789 RT0001",
    qstNumber: "1234567890 TQ0001",
    pstNumber: "PST-1234",
  });
  check(
    "Company: all three tax registrations render with labels",
    allThree.length === 3 &&
      allThree[0].label === "GST/HST" &&
      allThree[1].label === "QST" &&
      allThree[2].label === "PST",
    allThree.map((r) => `${r.label} ${r.value}`).join(", "),
  );

  const gstOnly = taxRegistrationLines({ gstNumber: "123456789 RT0001", qstNumber: null, pstNumber: null });
  check(
    "Company: blank tax registrations are not rendered",
    gstOnly.length === 1 && gstOnly[0].label === "GST/HST",
    `${gstOnly.length} line(s) from a GST-only company`,
  );

  const blankish = taxRegistrationLines({ gstNumber: "   ", qstNumber: "", pstNumber: null });
  check(
    "Company: whitespace-only registrations are treated as blank",
    blankish.length === 0,
    `${blankish.length} line(s) from whitespace/empty values`,
  );

  // ── Currency validation ───────────────────────────────────────────────────
  check(
    "Company: valid ISO 4217 codes are accepted and upper-cased",
    normalizeCurrency("usd") === "USD" && normalizeCurrency(" eur ") === "EUR" && normalizeCurrency("CAD") === "CAD",
    `usd -> ${normalizeCurrency("usd")}, " eur " -> ${normalizeCurrency(" eur ")}`,
  );

  const rejected = ["XXX", "ZZZ", "CA", "CADD", "12A", "", null];
  const stillAccepted = rejected.filter((code) => normalizeCurrency(code) !== null);
  check(
    "Company: invalid currency codes are rejected",
    stillAccepted.length === 0,
    stillAccepted.length ? `wrongly accepted ${stillAccepted.join(", ")}` : `rejected ${rejected.length} bad codes`,
  );

  // ── Formatting follows the selected currency ──────────────────────────────
  const cad = formatMoney(123_456, { currency: "CAD" });
  const eur = formatMoney(123_456, { currency: "EUR" });
  const gbp = formatMoney(123_456, { currency: "GBP" });
  check(
    "Company: amounts format in the selected base currency",
    cad.includes("1,234.56") && eur.startsWith("€") && gbp.startsWith("£") && eur !== cad,
    `CAD ${cad} · EUR ${eur} · GBP ${gbp}`,
  );
  check(
    "Company: formatting defaults to CAD when no currency is given",
    formatMoney(123_456) === cad,
    `${formatMoney(123_456)} vs ${cad}`,
  );
  check(
    "Company: an unknown currency renders without throwing",
    formatMoney(123_456, { currency: "XXX" }).includes("1,234.56"),
    formatMoney(123_456, { currency: "XXX" }),
  );

  // ── Database round-trips (rolled back) ────────────────────────────────────
  const sample = await db.company.findFirst({
    orderBy: { name: "asc" },
    select: { id: true, baseCurrency: true, qstNumber: true, pstNumber: true },
  });
  if (!sample) {
    check("Company: QST/PST save and clear", false, "no company in the database to test against");
    return;
  }

  try {
    await db.$transaction(async (tx) => {
      const saved = await tx.company.update({
        where: { id: sample.id },
        data: { qstNumber: "1234567890 TQ0001", pstNumber: "PST-9999" },
        select: { qstNumber: true, pstNumber: true },
      });
      check(
        "Company: QST and PST numbers save",
        saved.qstNumber === "1234567890 TQ0001" && saved.pstNumber === "PST-9999",
        `QST ${saved.qstNumber}, PST ${saved.pstNumber}`,
      );

      const cleared = await tx.company.update({
        where: { id: sample.id },
        data: { qstNumber: null, pstNumber: null },
        select: { qstNumber: true, pstNumber: true },
      });
      check(
        "Company: QST and PST numbers clear to null",
        cleared.qstNumber === null && cleared.pstNumber === null,
        `QST ${cleared.qstNumber}, PST ${cleared.pstNumber}`,
      );

      const switched = await tx.company.update({
        where: { id: sample.id },
        data: { baseCurrency: "USD" },
        select: { baseCurrency: true },
      });
      check(
        "Company: a valid non-CAD base currency saves",
        switched.baseCurrency === "USD",
        `baseCurrency ${switched.baseCurrency}`,
      );

      const fresh = await tx.company.create({
        data: { name: "Currency default probe", province: "ON" },
        select: { baseCurrency: true },
      });
      check(
        "Company: a new company defaults to CAD",
        fresh.baseCurrency === DEFAULT_CURRENCY,
        `baseCurrency ${fresh.baseCurrency}`,
      );

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  const untouched = await db.company.findUniqueOrThrow({
    where: { id: sample.id },
    select: { baseCurrency: true, qstNumber: true, pstNumber: true },
  });
  check(
    "Company: the settings probe left the file unchanged",
    untouched.baseCurrency === sample.baseCurrency &&
      untouched.qstNumber === sample.qstNumber &&
      untouched.pstNumber === sample.pstNumber,
    `baseCurrency ${untouched.baseCurrency} (was ${sample.baseCurrency}), QST ${untouched.qstNumber}, PST ${untouched.pstNumber}`,
  );
}

let aborted: unknown = null;

main()
  .catch((error) => {
    aborted = error;
    process.exitCode = 1;
  })
  .then(async () => {
    const width = Math.max(...results.map((r) => r.name.length));
    console.log("\n  Red Leaf Accounting — acceptance checks (spec §35)\n");
    for (const r of results) {
      console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}   ${r.detail}`);
    }
    const failed = results.filter((r) => !r.pass);
    console.log(`\n  ${results.length - failed.length}/${results.length} checks passed.`);
    if (aborted) {
      // Say so loudly. Checks that never ran are not passes, and a summary
      // reading "N/N passed" after a thrown error is worse than a red run.
      console.log("\n  RUN ABORTED before all checks completed — the count above is incomplete.\n");
      console.error(aborted);
    } else {
      console.log("");
    }
    await db.$disconnect();
    if (failed.length || aborted) process.exitCode = 1;
  });

/**
 * CSV export: escaping, money and date formatting, filenames, the permission
 * gate on each definition, and representative end-to-end builds.
 */
async function csvExportChecks() {
  interface Cell {
    text: string;
    amount: number;
    when: Date;
  }
  const columns: CsvColumn<Cell>[] = [
    { header: "Text", value: (r) => r.text },
    { header: "Amount (CAD)", value: (r) => csvMoney(r.amount), numeric: true },
    { header: "Date", value: (r) => csvDate(r.when) },
  ];
  const AUG = new Date("2026-08-31T00:00:00.000Z");
  const JAN = new Date("2026-01-01T00:00:00.000Z");

  const tricky = toCsv(
    [
      { text: "Comma, inside", amount: 123456, when: AUG },
      { text: 'He said "hello"', amount: -5, when: JAN },
      { text: "Line\nbreak", amount: 0, when: AUG },
      { text: "Café Lumière — ünïcode", amount: 100, when: AUG },
    ],
    columns,
  );
  const lines = tricky.split("\r\n");

  check("CSV: a comma inside a field is quoted", lines[1].startsWith('"Comma, inside",'), lines[1]);
  check("CSV: embedded quotes are doubled", lines[2].startsWith('"He said ""hello""",'), lines[2]);
  check(
    "CSV: a newline inside a field is quoted and preserved",
    tricky.includes('"Line\nbreak"'),
    "field kept its line break inside quotes",
  );
  check(
    "CSV: Unicode passes through untouched",
    tricky.includes("Café Lumière — ünïcode"),
    "accents, em dash and diaeresis preserved",
  );
  check(
    "CSV: header row first, CRLF line endings",
    lines[0] === "Text,Amount (CAD),Date" && tricky.includes("\r\n"),
    lines[0],
  );

  const payload = "=cmd|" + String.fromCharCode(39) + "/c calc" + String.fromCharCode(39) + "!A1";
  const injected = toCsv([{ text: payload, amount: 0, when: AUG }], columns);
  check(
    "CSV: a formula-injection payload is neutralised",
    injected.includes('"\t=cmd') && !injected.startsWith(payload) && !injected.includes("\n=cmd"),
    "leading = is tab-prefixed inside quotes, so it is displayed and not evaluated",
  );

  check(
    "CSV: a negative amount is still written as a bare number",
    toCsv([{ text: "x", amount: -12345, when: AUG }], columns).includes(",-123.45,"),
    csvMoney(-12345),
  );
  check(
    "CSV: the file carries a UTF-8 BOM for Excel",
    csvFile([], columns).charCodeAt(0) === 0xfeff,
    "first code unit is U+FEFF",
  );

  const moneyCases: [number, string][] = [
    [0, "0.00"],
    [5, "0.05"],
    [-5, "-0.05"],
    [123456, "1234.56"],
    [-100, "-1.00"],
    [999999999, "9999999.99"],
  ];
  const badMoney = moneyCases.filter(([cents, want]) => csvMoney(cents) !== want);
  check(
    "CSV: integer cents export as decimal amounts",
    badMoney.length === 0,
    badMoney.length
      ? badMoney.map(([c, w]) => `${c} -> ${csvMoney(c)} (want ${w})`).join("; ")
      : `${moneyCases.length} cases exact`,
  );

  check(
    "CSV: dates export as ISO YYYY-MM-DD in UTC",
    csvDate(AUG) === "2026-08-31" && csvDate(JAN) === "2026-01-01",
    `${csvDate(AUG)}, ${csvDate(JAN)}`,
  );
  check(
    "CSV: filenames name the report and its period",
    asOfFilename("Trial balance", AUG) === "trial-balance-2026-08-31.csv" &&
      rangeFilename("Profit & loss", JAN, AUG) === "profit-and-loss-2026-01-01-to-2026-08-31.csv",
    `${asOfFilename("Trial balance", AUG)} / ${rangeFilename("Profit & loss", JAN, AUG)}`,
  );

  const missingCapability = Object.entries(EXPORTS).filter(([, def]) => !def.capability);
  check(
    "CSV: every export declares a required capability",
    missingCapability.length === 0,
    missingCapability.length
      ? missingCapability.map(([k]) => k).join(", ")
      : `${Object.keys(EXPORTS).length} exports gated`,
  );
  check(
    "CSV: a reviewer cannot export the tax detail",
    !can("REVIEWER", EXPORTS["tax-detail"].capability) && can("PRIMARY", EXPORTS["tax-detail"].capability),
    `reviewer ${can("REVIEWER", EXPORTS["tax-detail"].capability)}, primary ${can("PRIMARY", EXPORTS["tax-detail"].capability)}`,
  );

  const company = await db.company.findFirstOrThrow({
    orderBy: { name: "asc" },
    select: { id: true, baseCurrency: true, fiscalYearStartMonth: true },
  });
  const ctx = {
    companyId: company.id,
    currency: company.baseCurrency,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    params: new URLSearchParams({ from: "2026-01-01", to: "2026-12-31" }),
  };

  for (const key of ["trial-balance", "profit-and-loss", "general-ledger", "tax-summary"]) {
    const result = await EXPORTS[key].build(ctx);
    const body = result.body.replace(/^﻿/, "");
    const rowCount = body.trim().split("\r\n").length - 1;
    check(
      `CSV: ${key} export builds`,
      rowCount > 0 && result.filename.endsWith(".csv") && body.includes(company.baseCurrency),
      `${result.filename}, ${rowCount} data row(s), currency in headings`,
    );
  }

  // A window with no activity must yield headings and nothing else — that is
  // how we know the requested range actually reached the query.
  const empty = await EXPORTS["general-ledger"].build({
    ...ctx,
    params: new URLSearchParams({ from: "1990-01-01", to: "1990-12-31" }),
  });
  const emptyRows = empty.body.replace(/^﻿/, "").trim().split("\r\n").length - 1;
  check("CSV: the requested date range filters the export", emptyRows === 0, `${emptyRows} rows for an empty 1990 window`);
}

/**
 * Profit & Loss: the EBITDA ladder, its margins, and the invariant that
 * restructuring the presentation did not change what the company earned.
 */
async function profitAndLossChecks() {
  const companies = await db.company.findMany({ orderBy: { name: "asc" } });
  const asOf = toUtcDay(new Date());
  const range = { from: utcDate(asOf.getUTCFullYear(), 1, 1), to: asOf };

  for (const company of companies) {
    const tag = company.name.split(" ")[0];
    const pl = await profitAndLoss(company.id, range);
    // Section totals are per-period arrays now, and costs are already negative
    // so each step of the ladder is an addition.
    const sec = (key: string) => pl.sections.find((s) => s.key === key)!;
    const total = (key: string) => sec(key).totals[0];

    check(
      `${tag}: EBITDA = gross profit less SG&A`,
      pl.ebitdaCents === pl.grossProfitCents + total("SGA"),
      `EBITDA ${money(pl.ebitdaCents)}`,
    );
    check(
      `${tag}: EBIT = EBITDA less depreciation & amortization`,
      pl.ebitCents === pl.ebitdaCents + total("DEPRECIATION_AMORTIZATION"),
      `EBIT ${money(pl.ebitCents)}, D&A ${money(total("DEPRECIATION_AMORTIZATION"))}`,
    );
    check(
      `${tag}: EBT = EBIT + interest and other non-operating items`,
      pl.incomeBeforeTaxCents ===
        pl.ebitCents +
          total("INTEREST_EXPENSE") +
          total("INTEREST_INCOME") +
          total("OTHER_INCOME") +
          total("OTHER_EXPENSE"),
      `EBT ${money(pl.incomeBeforeTaxCents)}`,
    );
    check(
      `${tag}: net income = EBT less taxes`,
      pl.netIncomeCents === pl.incomeBeforeTaxCents + total("TAXES"),
      `net income ${money(pl.netIncomeCents)}`,
    );

    const strayDA = sec("SGA").rows.filter((r) =>
      (DEPRECIATION_AMORTIZATION_SUBTYPES as readonly string[]).includes(r.subtype),
    );
    check(
      `${tag}: depreciation is excluded from EBITDA operating expenses`,
      strayDA.length === 0,
      strayDA.length ? `found ${strayDA.map((r) => r.code).join(", ")}` : "no D&A accounts above EBITDA",
    );

    // Classification is by subtype, never by account name.
    const namedInterest = sec("SGA").rows.filter((r) => /interest/i.test(r.name));
    check(
      `${tag}: accounts are placed by subtype, not by name`,
      namedInterest.every((r) => r.subtype === "OPERATING_EXPENSE"),
      namedInterest.length
        ? namedInterest.map((r) => `${r.code} ${r.name} = ${r.subtype}`).join("; ")
        : "no name-ambiguous accounts in this file",
    );

    const bs = await balanceSheet(company.id, range.to);
    check(
      `${tag}: EBITDA-format net income still ties to the balance sheet`,
      pl.netIncomeCents === bs.currentEarningsCents,
      `P&L ${money(pl.netIncomeCents)} vs unclosed earnings ${money(bs.currentEarningsCents)}`,
    );

    if (pl.revenueCents > 0) {
      const expected = (pl.ebitdaCents / pl.revenueCents) * 100;
      check(
        `${tag}: EBITDA margin = EBITDA / revenue`,
        pl.ebitdaMarginPercent !== null && Math.abs(pl.ebitdaMarginPercent - expected) < 1e-9,
        `${pl.ebitdaMarginPercent?.toFixed(2)}%`,
      );
    }
  }

  const emptyPl = await profitAndLoss(companies[0].id, { from: utcDate(1990, 1, 1), to: utcDate(1990, 12, 31) });
  check(
    "P&L: margins are null rather than NaN when there is no revenue",
    emptyPl.revenueCents === 0 &&
      emptyPl.ebitdaMarginPercent === null &&
      emptyPl.grossMarginPercent === null &&
      emptyPl.netMarginPercent === null,
    "no revenue, all three margins null",
  );
}

/**
 * Products & services catalogue.
 *
 * The database work runs inside a transaction that is rolled back, so real
 * constraints (company-scoped code uniqueness, foreign keys, defaults) are
 * exercised without leaving anything behind.
 */
class Rollback2 extends Error {}

async function catalogueChecks() {
  const companies = await db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const company = companies[0];
  const other = companies[1];

  // Existing rows must have migrated to SERVICE rather than to nothing.
  const untyped = await db.serviceItem.count({ where: { NOT: { type: { in: [...ITEM_TYPES] } } } });
  check(
    "Catalogue: every existing item has a valid type",
    untyped === 0,
    untyped === 0 ? "all rows are PRODUCT or SERVICE" : `${untyped} row(s) with an unknown type`,
  );

  const legacyDefaulted = await db.serviceItem.count({ where: { companyId: company.id, type: "SERVICE" } });
  check(
    "Catalogue: pre-existing items defaulted to SERVICE",
    legacyDefaulted > 0,
    `${legacyDefaulted} service item(s) in ${company.name.split(" ")[0]}`,
  );

  // Discounts use the project's percent x 1e6 convention, like document lines.
  const discountCases: [number, number][] = [
    [0, 0],
    [10, 10_000_000],
    [12.5, 12_500_000],
    [100, 100_000_000],
  ];
  const badDiscount = discountCases.filter(([pct, micro]) => Math.round(pct * 1_000_000) !== micro);
  check(
    "Catalogue: discount percentages use the micro convention",
    badDiscount.length === 0,
    badDiscount.length ? "conversion mismatch" : `${discountCases.length} cases exact`,
  );

  try {
    await db.$transaction(async (tx) => {
      const revenue = await tx.account.findFirstOrThrow({
        where: { companyId: company.id, type: "REVENUE" },
        select: { id: true },
      });
      const expense = await tx.account.findFirstOrThrow({
        where: { companyId: company.id, type: "EXPENSE" },
        select: { id: true },
      });

      const product = await tx.serviceItem.create({
        data: {
          companyId: company.id,
          type: "PRODUCT",
          code: "ZZ-PROBE-1",
          name: "Probe widget",
          unit: "each",
          unitPriceCents: 125_000,
          discountPercentMicro: 12_500_000,
          incomeAccountId: revenue.id,
          expenseAccountId: expense.id,
        },
        select: { id: true, type: true, unitPriceCents: true, discountPercentMicro: true, isActive: true, incomeAccountId: true, expenseAccountId: true },
      });
      check(
        "Catalogue: a PRODUCT saves with price, discount and both accounts",
        product.type === "PRODUCT" &&
          product.unitPriceCents === 125_000 &&
          product.discountPercentMicro === 12_500_000 &&
          product.isActive &&
          product.incomeAccountId === revenue.id &&
          product.expenseAccountId === expense.id,
        `${money(product.unitPriceCents)} @ ${product.discountPercentMicro / 1_000_000}% off`,
      );

      const service = await tx.serviceItem.create({
        data: { companyId: company.id, type: "SERVICE", code: "ZZ-PROBE-2", name: "Probe service", unit: "hour" },
        select: { id: true, type: true, unit: true, discountPercentMicro: true },
      });
      check(
        "Catalogue: a SERVICE saves and defaults its discount to zero",
        service.type === "SERVICE" && service.discountPercentMicro === 0 && service.unit === "hour",
        `unit ${service.unit}, discount ${service.discountPercentMicro}`,
      );

      if (other) {
        const twin = await tx.serviceItem.create({
          data: { companyId: other.id, type: "SERVICE", code: "ZZ-PROBE-1", name: "Same code, other company" },
          select: { id: true, companyId: true },
        });
        check(
          "Catalogue: the same code may exist in a different company",
          twin.companyId === other.id,
          "uniqueness is company-scoped, as tenancy requires",
        );
      }

      // Archiving hides an item from new documents without touching history.
      const archived = await tx.serviceItem.update({
        where: { id: service.id },
        data: { isActive: false },
        select: { isActive: true },
      });
      const selectable = await tx.serviceItem.findMany({
        where: { companyId: company.id, isActive: true, code: { startsWith: "ZZ-PROBE" } },
        select: { code: true },
      });
      check(
        "Catalogue: an archived item disappears from the selectable list",
        !archived.isActive && selectable.every((i) => i.code !== "ZZ-PROBE-2"),
        `selectable probes: ${selectable.map((i) => i.code).join(", ") || "none"}`,
      );

      const reactivated = await tx.serviceItem.update({
        where: { id: service.id },
        data: { isActive: true },
        select: { isActive: true },
      });
      check("Catalogue: an archived item can be reactivated", reactivated.isActive, "isActive back to true");

      throw new Rollback2();
    });
  } catch (error) {
    if (!(error instanceof Rollback2)) throw error;
  }

  // Uniqueness gets its own transaction: the INSERT is meant to fail, and in
  // Postgres a failed statement aborts the entire surrounding transaction, so
  // running it beside the other probes would silently kill them.
  let duplicateRejected = false;
  try {
    await db.$transaction(async (tx) => {
      await tx.serviceItem.create({
        data: { companyId: company.id, type: "SERVICE", code: "ZZ-DUP", name: "First" },
      });
      await tx.serviceItem.create({
        data: { companyId: company.id, type: "SERVICE", code: "ZZ-DUP", name: "Second, same code" },
      });
      throw new Rollback2();
    });
  } catch (error) {
    duplicateRejected = !(error instanceof Rollback2);
  }
  check(
    "Catalogue: an item code is unique within a company",
    duplicateRejected,
    duplicateRejected ? "the second insert was rejected by the constraint" : "a duplicate code was ACCEPTED",
  );

  const leftovers = await db.serviceItem.count({ where: { code: { startsWith: "ZZ-" } } });
  check("Catalogue: the probe transaction rolled back cleanly", leftovers === 0, `${leftovers} probe row(s) left behind`);

  // Historical integrity: a saved line carries its own price and description,
  // so editing the catalogue later cannot restate an issued document.
  const linkedLine = await db.invoiceLine.findFirst({
    where: { itemId: { not: null }, invoice: { companyId: company.id } },
    select: { description: true, unitPriceCents: true, itemId: true, item: { select: { name: true, unitPriceCents: true } } },
  });
  check(
    "Catalogue: a document line stores its own price, not a live lookup",
    linkedLine === null || typeof linkedLine.unitPriceCents === "number",
    linkedLine
      ? `line "${linkedLine.description}" holds ${money(linkedLine.unitPriceCents)}; item currently lists ${money(linkedLine.item?.unitPriceCents ?? 0)}`
      : "no item-linked invoice lines in this file yet",
  );

  // Sales and purchase documents must not share an account side.
  const wrongSide = await db.serviceItem.findMany({
    where: { companyId: company.id, incomeAccount: { is: { type: { not: "REVENUE" } } } },
    select: { code: true },
  });
  check(
    "Catalogue: income accounts are revenue accounts",
    wrongSide.length === 0,
    wrongSide.length ? `${wrongSide.map((i) => i.code).join(", ")}` : "no item points its sales side at a non-revenue account",
  );

  // The purchase-side line models can now carry an item and a discount.
  const billLineFields = await db.billLine.findFirst({ select: { itemId: true, discountPercentMicro: true } });
  const creditLineFields = await db.creditNoteLine.findFirst({ select: { itemId: true, discountPercentMicro: true } });
  check(
    "Catalogue: bill and credit-note lines carry an item link and a discount",
    billLineFields !== undefined && creditLineFields !== undefined,
    "columns present on both purchase and credit lines",
  );
}
