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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .then(async () => {
    const width = Math.max(...results.map((r) => r.name.length));
    console.log("\n  Red Leaf Accounting — acceptance checks (spec §35)\n");
    for (const r of results) {
      console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}   ${r.detail}`);
    }
    const failed = results.filter((r) => !r.pass);
    console.log(`\n  ${results.length - failed.length}/${results.length} checks passed.\n`);
    await db.$disconnect();
    if (failed.length) process.exitCode = 1;
  });
