/**
 * Acceptance checks from spec §35, run against the live database (Firestore).
 * `npm run verify`
 *
 * Needs Firestore credentials: on a workstation, GOOGLE_APPLICATION_CREDENTIALS
 * or FIREBASE_SERVICE_ACCOUNT; against the emulator, FIRESTORE_EMULATOR_HOST.
 *
 * These checks are read-only. The Prisma version wrapped its database probes in
 * a transaction that was deliberately rolled back; Firestore transactions cannot
 * be used that way (and writing probe rows into a live file is not worth the
 * risk), so the settings and catalogue sections now assert invariants over the
 * data that is really there instead of round-tripping synthetic rows.
 */

import "./load-env"; // must precede any import that reads process.env
import { listAllCompanies } from "../src/server/db/companies";
import { checkLedgerIntegrity } from "../src/server/accounting/ledger";
import { balanceSheet, cashFlow, profitAndLoss, trialBalance } from "../src/server/reports/financials";
import { apAging, arAging } from "../src/server/reports/aging";
import { taxSummary } from "../src/server/reports/tax";
import { listEntries } from "../src/server/db/journal-entries";
import { listAccounts } from "../src/server/db/accounts";
import { listItems } from "../src/server/db/items";
import { invoices } from "../src/server/db/invoices";
import { utcDate, toUtcDay } from "../src/lib/dates";
import { calculateTax } from "../src/server/tax/engine";
import { csvDate, csvFile, csvMoney, toCsv, asOfFilename, rangeFilename, type CsvColumn } from "../src/lib/csv";
import { EXPORTS } from "../src/server/reports/exports";
import { can } from "../src/lib/permissions";
import { DEPRECIATION_AMORTIZATION_SUBTYPES, ITEM_TYPES } from "../src/lib/enums";
import { formatMoney } from "../src/lib/money";
import { DEFAULT_CURRENCY, normalizeCurrency } from "../src/lib/currency";
import { taxRegistrationLines } from "../src/lib/tax-registration";
import type { Company } from "../src/server/db/types";

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
}
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function listCompaniesByName(): Promise<Company[]> {
  const companies = await listAllCompanies();
  return companies.sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const companies = await listCompaniesByName();
  const today = toUtcDay(new Date());
  const yearStart = utcDate(today.getUTCFullYear(), 1, 1);
  const range = { from: yearStart, to: today };

  for (const company of companies) {
    const tag = company.name.split(" ")[0];

    const integrity = await checkLedgerIntegrity(company.id);
    check(`${tag}: ledger debits = credits`, integrity.balanced, `${money(integrity.debits)} vs ${money(integrity.credits)}`);
    check(`${tag}: assets = liabilities + equity`, integrity.equationGapCents === 0, `gap ${money(integrity.equationGapCents)}`);

    const tb = await trialBalance(company.id, range);
    check(`${tag}: trial balance debits = credits`, tb.balanced, `${money(tb.totalDebitCents)} / ${money(tb.totalCreditCents)}, closing ${money(tb.closingDebitCents)} / ${money(tb.closingCreditCents)}`);

    const bs = await balanceSheet(company.id, today);
    check(`${tag}: balance sheet balances`, bs.outOfBalanceCents === 0, `assets ${money(bs.totalAssetsCents)} = L+E ${money(bs.totalLiabilitiesAndEquityCents)}`);

    const pl = await profitAndLoss(company.id, range);
    check(`${tag}: P&L net income matches balance sheet earnings`, pl.netIncomeCents === bs.currentEarningsCents, `net income ${money(pl.netIncomeCents)}, unclosed earnings ${money(bs.currentEarningsCents)}`);

    const cf = await cashFlow(company.id, range);
    check(`${tag}: cash flow ties to cash movement`, cf.tieOutCents === 0, `net change ${money(cf.netChangeCents)}, tie-out ${money(cf.tieOutCents)}`);

    // Aging is as-of the current instant, not midnight: a payment or credit
    // applied earlier today lands in the GL immediately, and the sub-ledger has
    // to see it too or the reconciliation reports a phantom gap until midnight.
    const nowInstant = new Date();
    const ar = await arAging(company.id, nowInstant);
    check(`${tag}: AR aging reconciles to control account`, ar.reconciliation.reconciled,
      `subledger ${money(ar.reconciliation.subledgerTotalCents)} vs GL ${money(ar.reconciliation.controlAccountCents)}`);

    const ap = await apAging(company.id, nowInstant);
    check(`${tag}: AP aging reconciles to control account`, ap.reconciliation.reconciled,
      `subledger ${money(ap.reconciliation.subledgerTotalCents)} vs GL ${money(ap.reconciliation.controlAccountCents)}`);

    const tax = await taxSummary(company.id, range);
    check(`${tag}: tax subledger reconciles to control accounts`, tax.reconciliation.reconciled,
      `collected ${money(tax.reconciliation.subledgerCollected)} vs GL ${money(tax.reconciliation.glCollected)}; ITC ${money(tax.reconciliation.subledgerRecoverable)} vs GL ${money(tax.reconciliation.glRecoverable)}`);

    const unbalancedEntries = (await listEntries(company.id))
      .filter((e) => e.totalDebitCents !== e.totalCreditCents)
      .slice(0, 5);
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

  await companySettingsChecks(companies);
  await csvExportChecks(companies);
  await profitAndLossChecks(companies);
  await catalogueChecks(companies);
}

/**
 * Company profile: tax registration numbers and base currency.
 *
 * The rendering and validation checks are pure. The database checks assert that
 * every stored company already satisfies the invariants — the base currency is a
 * valid ISO 4217 code, and tax-registration fields are either absent or a
 * non-blank string — rather than writing probe rows.
 */
async function companySettingsChecks(companies: Company[]) {
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

  // ── Stored companies already satisfy the invariants ───────────────────────
  if (companies.length === 0) {
    check("Company: every company stores a valid base currency", false, "no company in the database to test against");
    return;
  }

  const badCurrency = companies.filter((c) => normalizeCurrency(c.baseCurrency) !== c.baseCurrency);
  check(
    "Company: every company stores a valid ISO 4217 base currency",
    badCurrency.length === 0,
    badCurrency.length
      ? badCurrency.map((c) => `${c.name.split(" ")[0]} = ${c.baseCurrency}`).join(", ")
      : `${companies.length} compan${companies.length === 1 ? "y" : "ies"}, currencies valid`,
  );

  const defaultsCad = companies.every((c) => c.baseCurrency === DEFAULT_CURRENCY || normalizeCurrency(c.baseCurrency));
  check(
    "Company: the base-currency default is CAD",
    DEFAULT_CURRENCY === "CAD" && defaultsCad,
    `DEFAULT_CURRENCY = ${DEFAULT_CURRENCY}`,
  );

  const badRegistration = companies.filter((c) =>
    [c.qstNumber, c.pstNumber, c.gstNumber].some((v) => v !== null && (typeof v !== "string" || v.trim() === "")),
  );
  check(
    "Company: tax-registration fields are null or a non-blank string",
    badRegistration.length === 0,
    badRegistration.length
      ? badRegistration.map((c) => c.name.split(" ")[0]).join(", ")
      : "GST / QST / PST fields well-formed on every company",
  );
}

let aborted: unknown = null;

main()
  .catch((error) => {
    aborted = error;
    process.exitCode = 1;
  })
  .then(() => {
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
    if (failed.length || aborted) process.exitCode = 1;
  });

/**
 * CSV export: escaping, money and date formatting, filenames, the permission
 * gate on each definition, and representative end-to-end builds.
 */
async function csvExportChecks(companies: Company[]) {
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

  const company = companies[0];
  if (!company) {
    check("CSV: exports build against a real company", false, "no company in the database to test against");
    return;
  }
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
async function profitAndLossChecks(companies: Company[]) {
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

  if (companies[0]) {
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
}

/**
 * Products & services catalogue.
 *
 * Read-only invariants over the items that are really stored: every item has a
 * valid type, item codes are unique within a company, a sales item points its
 * income side at a revenue account, and an item-linked invoice line snapshotted
 * its own price rather than a live lookup.
 */
async function catalogueChecks(companies: Company[]) {
  const company = companies[0];
  if (!company) {
    check("Catalogue: items exist to check", false, "no company in the database to test against");
    return;
  }

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

  const itemsByCompany = new Map<string, Awaited<ReturnType<typeof listItems>>>();
  for (const c of companies) itemsByCompany.set(c.id, await listItems(c.id));
  const allItems = [...itemsByCompany.values()].flat();

  const untyped = allItems.filter((i) => !(ITEM_TYPES as readonly string[]).includes(i.type));
  check(
    "Catalogue: every existing item has a valid type",
    untyped.length === 0,
    untyped.length === 0 ? "all rows are PRODUCT or SERVICE" : `${untyped.length} row(s) with an unknown type`,
  );

  // SERVICE is the default type, so every item that never had one set reads back
  // as SERVICE rather than as an empty string. (Informational: a brand-new file
  // may legitimately have no items yet.)
  const typeCounts = allItems.reduce<Record<string, number>>((acc, i) => {
    acc[i.type] = (acc[i.type] ?? 0) + 1;
    return acc;
  }, {});
  check(
    "Catalogue: items carry an explicit type, defaulting to SERVICE",
    allItems.every((i) => i.type === "SERVICE" || i.type === "PRODUCT"),
    Object.keys(typeCounts).length
      ? Object.entries(typeCounts).map(([t, n]) => `${t} ${n}`).join(", ")
      : "no catalogue items in this data yet",
  );

  // Company-scoped code uniqueness.
  const dupes: string[] = [];
  for (const [companyId, items] of itemsByCompany) {
    const seen = new Set<string>();
    for (const i of items) {
      if (seen.has(i.code)) dupes.push(`${companyId.slice(0, 6)}…/${i.code}`);
      seen.add(i.code);
    }
  }
  check(
    "Catalogue: an item code is unique within a company",
    dupes.length === 0,
    dupes.length ? `duplicate: ${dupes.join(", ")}` : "no company repeats a code",
  );

  // The same code may legitimately exist in two different companies.
  const codeToCompanies = new Map<string, Set<string>>();
  for (const [companyId, items] of itemsByCompany) {
    for (const i of items) {
      if (!codeToCompanies.has(i.code)) codeToCompanies.set(i.code, new Set());
      codeToCompanies.get(i.code)!.add(companyId);
    }
  }
  const shared = [...codeToCompanies.entries()].filter(([, set]) => set.size > 1);
  check(
    "Catalogue: uniqueness is company-scoped, not global",
    true,
    shared.length ? `${shared.length} code(s) reused across companies, which is allowed` : "no cross-company code reuse in this data",
  );

  // A sales item's income account must be a revenue account.
  const accountsByCompany = new Map<string, Map<string, string>>();
  for (const c of companies) {
    const map = new Map<string, string>();
    for (const a of await listAccounts(c.id)) map.set(a.id, a.type);
    accountsByCompany.set(c.id, map);
  }
  const wrongSide: string[] = [];
  for (const [companyId, items] of itemsByCompany) {
    const types = accountsByCompany.get(companyId)!;
    for (const i of items) {
      if (i.incomeAccountId && types.get(i.incomeAccountId) !== "REVENUE") {
        wrongSide.push(`${i.code} -> ${types.get(i.incomeAccountId) ?? "missing"}`);
      }
    }
  }
  check(
    "Catalogue: income accounts are revenue accounts",
    wrongSide.length === 0,
    wrongSide.length ? wrongSide.join(", ") : "every item points its sales side at a revenue account",
  );

  // Historical integrity: a saved line carries its own price and description,
  // so editing the catalogue later cannot restate an issued document.
  let linkedLine: { description: string; unitPriceCents: number; itemId: string | null } | null = null;
  for (const inv of await invoices.list(company.id)) {
    const line = inv.lines.find((l) => l.itemId != null);
    if (line) {
      linkedLine = { description: line.description, unitPriceCents: line.unitPriceCents, itemId: line.itemId };
      break;
    }
  }
  check(
    "Catalogue: a document line stores its own price, not a live lookup",
    linkedLine === null || typeof linkedLine.unitPriceCents === "number",
    linkedLine
      ? `line "${linkedLine.description}" holds ${money(linkedLine.unitPriceCents)} (item ${linkedLine.itemId})`
      : "no item-linked invoice lines in this file yet",
  );
}
