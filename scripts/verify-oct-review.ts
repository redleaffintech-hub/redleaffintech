/**
 * Checks for the 25 Oct 2026 review changes: opening balances, payment
 * unallocation, fixed assets / depreciation, QPP and hourly pay.
 *
 * It WRITES fixtures (and leaves them), so run it against a scratch database only:
 *   DATABASE_URL=... DATABASE_URL_UNPOOLED=... node --conditions=react-server --import tsx scripts/verify-oct-review.ts
 */

import "./load-env"; // must precede any import that reads process.env
import { db } from "../src/lib/db";
import { SYSTEM_ACCOUNTS } from "../src/lib/enums";
import { checkLedgerIntegrity } from "../src/server/accounting/ledger";
import { arAging, apAging } from "../src/server/reports/aging";
import { setOpeningBalance } from "../src/server/documents/opening-balance";
import { recordPayment, unallocatePayment } from "../src/server/documents/payments";
import { adjustStock } from "../src/server/inventory/costing";
import { createAsset, continuitySchedule, disposeAsset, previewDepreciation, reverseLatestRun, runDepreciation, saveCategory } from "../src/server/accounting/fixed-assets";
import { computeCppAndEi } from "../src/server/payroll/tax-engine";
import { defaultPeriodHours, hourlyRegularPayCents } from "../src/lib/payroll-hours";
import { monthlyCharge } from "../src/lib/depreciation";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail: string) => results.push({ name, pass, detail });
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const stamp = Date.now();

async function main() {
  const company = await db.company.findFirstOrThrow({ where: { name: { startsWith: "Northbridge" } } });
  const companyId = company.id;
  const today = new Date();
  const year = today.getUTCFullYear();
  const day = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d));

  // ── Customer opening balance ──────────────────────────────────────────────
  const customer = await db.customer.create({ data: { companyId, name: `ZZ Opening Customer ${stamp}` } });
  const vendor = await db.vendor.create({ data: { companyId, name: `ZZ Opening Vendor ${stamp}` } });

  await setOpeningBalance({ companyId, party: "CUSTOMER", partyId: customer.id, amountCents: 125_000, date: day(7, 1) });
  const ar = await arAging(companyId, today);
  const arRow = ar.rows.find((r) => r.partyId === customer.id);
  check("Opening balance: customer's opening balance shows in AR aging", arRow?.totalCents === 125_000, `aging total ${money(arRow?.totalCents ?? 0)}`);
  check("Opening balance: AR aging still reconciles to the control account", ar.reconciliation.reconciled, `subledger ${money(ar.reconciliation.subledgerTotalCents)} vs GL ${money(ar.reconciliation.controlAccountCents)}`);

  await setOpeningBalance({ companyId, party: "CUSTOMER", partyId: customer.id, amountCents: 100_000, date: day(7, 1) });
  const arAfter = (await arAging(companyId, today)).rows.find((r) => r.partyId === customer.id);
  check("Opening balance: editing re-issues instead of stacking (no double count)", arAfter?.totalCents === 100_000, `aging total ${money(arAfter?.totalCents ?? 0)}`);

  // ── Payment against the opening invoice, then unallocate ──────────────────
  const bank = await db.account.findFirstOrThrow({ where: { companyId, subtype: "BANK", isActive: true } });
  const openingInvoice = await db.invoice.findFirstOrThrow({ where: { companyId, customerId: customer.id, status: { not: "VOID" } } });
  const payment = await recordPayment({
    companyId, type: "RECEIPT", customerId: customer.id, bankAccountId: bank.id, date: today, amountCents: 40_000,
    allocations: [{ invoiceId: openingInvoice.id, amountCents: 40_000 }],
  });
  const paid = await db.invoice.findUniqueOrThrow({ where: { id: openingInvoice.id } });
  check("Unallocate: invoice is partially paid after the receipt", paid.status === "PARTIALLY_PAID" && paid.balanceCents === 60_000, `${paid.status}, balance ${money(paid.balanceCents)}`);

  let blocked = false;
  try {
    await setOpeningBalance({ companyId, party: "CUSTOMER", partyId: customer.id, amountCents: 90_000, date: day(7, 1) });
  } catch {
    blocked = true;
  }
  check("Opening balance: cannot be changed while a payment is applied", blocked, blocked ? "refused until unallocated" : "was allowed");

  const allocation = await db.paymentAllocation.findFirstOrThrow({ where: { paymentId: payment.id } });
  await unallocatePayment(companyId, allocation.id);
  const reopened = await db.invoice.findUniqueOrThrow({ where: { id: openingInvoice.id } });
  const payAfter = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  check("Unallocate: invoice reopens for its full balance", reopened.status !== "PAID" && reopened.balanceCents === 100_000 && reopened.amountPaidCents === 0, `${reopened.status}, balance ${money(reopened.balanceCents)}`);
  check("Unallocate: the payment stays as unapplied credit", payAfter.status === "POSTED" && payAfter.unappliedCents === 40_000 && payAfter.appliedCents === 0, `unapplied ${money(payAfter.unappliedCents)}`);

  // ── Vendor opening balance ────────────────────────────────────────────────
  await setOpeningBalance({ companyId, party: "VENDOR", partyId: vendor.id, amountCents: 75_000, date: day(7, 1) });
  const ap = await apAging(companyId, today);
  check("Opening balance: vendor's opening balance shows in AP aging", ap.rows.find((r) => r.partyId === vendor.id)?.totalCents === 75_000, "AP aging row present");
  check("Opening balance: AP aging still reconciles to the control account", ap.reconciliation.reconciled, `subledger ${money(ap.reconciliation.subledgerTotalCents)} vs GL ${money(ap.reconciliation.controlAccountCents)}`);

  // ── Inventory opening stock ───────────────────────────────────────────────
  const item = await db.serviceItem.create({ data: { companyId, type: "PRODUCT", code: `ZZ-OPEN-${stamp}`, name: "Opening stock probe", trackInventory: true, unit: "each" } });
  const obe = await db.account.findFirstOrThrow({ where: { companyId, systemKey: SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY } });
  await db.$transaction((tx) =>
    adjustStock(tx, { companyId, itemId: item.id, date: day(7, 1), quantityMilli: 10_000, unitCostCents: 2_500, offsetAccountId: obe.id, reason: "Opening stock" }),
  );
  const stocked = await db.serviceItem.findUniqueOrThrow({ where: { id: item.id } });
  check("Inventory: opening stock sets quantity and average cost", stocked.quantityOnHandMilli === 10_000 && stocked.averageCostCents === 2_500, `${stocked.quantityOnHandMilli / 1000} on hand @ ${money(stocked.averageCostCents)}`);

  // ── Fixed assets ──────────────────────────────────────────────────────────
  const equipment = await db.account.findFirstOrThrow({ where: { companyId, subtype: "FIXED_ASSET" } });
  const accumulated = await db.account.findFirstOrThrow({ where: { companyId, subtype: "ACCUMULATED_DEPRECIATION" } });
  const expense = await db.account.findFirstOrThrow({ where: { companyId, subtype: "DEPRECIATION" } });
  const category = await saveCategory({
    companyId, name: `ZZ Computers ${stamp}`, assetAccountId: equipment.id, accumulatedDepreciationAccountId: accumulated.id,
    depreciationExpenseAccountId: expense.id, method: "STRAIGHT_LINE", usefulLifeMonths: 36, decliningRatePercent: 0, residualPercent: 0,
  });
  const asset = await createAsset({ companyId, categoryId: category.id, name: "Probe laptop", acquisitionDate: day(7, 1), costCents: 360_000 });

  const preview = await previewDepreciation(companyId, day(9, 30));
  const mine = preview.items.find((i) => i.assetId === asset.id);
  check("Depreciation: 3 months of straight-line on $3,600 over 36 months is $300", mine?.totalCents === 30_000 && mine.months.length === 3, `${mine?.months.length} month(s), ${money(mine?.totalCents ?? 0)}`);

  const before = await checkLedgerIntegrity(db, companyId);
  const run = await runDepreciation(companyId, day(9, 30));
  const after = await checkLedgerIntegrity(db, companyId);
  check("Depreciation: the run posts a balanced journal entry", after.balanced && after.debits - before.debits === run.totalCents, `posted ${money(run.totalCents)}`);

  const again = await previewDepreciation(companyId, day(9, 30));
  check("Depreciation: running the same month again finds nothing (no double charge)", !again.items.some((i) => i.assetId === asset.id), "no items for the probe asset");
  let rerunBlocked = false;
  try {
    await runDepreciation(companyId, day(9, 30));
  } catch (error) {
    rerunBlocked = /nothing left|no depreciation left/i.test((error as Error).message);
  }
  check("Depreciation: a second run for the same month is refused when nothing is left", rerunBlocked || again.items.length > 0, rerunBlocked ? "refused" : "other assets still pending");

  const schedule = await continuitySchedule(companyId, day(1, 1), day(12, 31));
  const row = schedule.find((r) => r.categoryId === category.id)!;
  check("Schedule: closing accumulated = opening + depreciation - disposals", row.closingAccumulatedCents === row.openingAccumulatedCents + row.depreciationCents - row.disposalAccumulatedCents, `closing ${money(row.closingAccumulatedCents)}, NBV ${money(row.netBookValueCents)}`);

  const gainLoss = await db.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } });
  const disposed = await disposeAsset({ companyId, assetId: asset.id, date: day(10, 15), proceedsCents: 200_000, proceedsAccountId: bank.id, gainLossAccountId: gainLoss.id });
  const afterDisposal = await checkLedgerIntegrity(db, companyId);
  check("Disposal: posts a balanced entry and marks the asset disposed", disposed.status === "DISPOSED" && afterDisposal.balanced, `status ${disposed.status}`);

  await reverseLatestRun(companyId, run.id).then(
    () => check("Depreciation: the latest run can be reversed", true, "reversed"),
    (error: Error) => check("Depreciation: the latest run can be reversed", false, error.message),
  );

  // ── Straight-line / pro-rata unit checks ──────────────────────────────────
  const base = { costCents: 120_000, residualCents: 0, method: "STRAIGHT_LINE", usefulLifeMonths: 12, decliningRateMicro: 0, openingAccumulatedCents: 0, openingAsOf: null };
  const midMonth = monthlyCharge({ ...base, inServiceDate: new Date(Date.UTC(2026, 0, 16)) }, new Date(Date.UTC(2026, 0, 31)), 0);
  check("Depreciation: first month is pro-rated by days (16 Jan = 16/31 of $100)", midMonth === Math.round(10_000 * 16 / 31), money(midMonth));
  const capped = monthlyCharge({ ...base, inServiceDate: new Date(Date.UTC(2026, 0, 1)) }, new Date(Date.UTC(2027, 5, 30)), 118_000);
  check("Depreciation: the final charge never exceeds what is left to depreciate", capped === 2_000, money(capped));

  // ── Payroll ───────────────────────────────────────────────────────────────
  // 2026 figures in the app's rateMicro convention (percent x 10_000).
  const rates = {
    id: "t", cppRateMicro: 59_500, cppBasicExemptionCents: 350_000, cppMaxPensionableEarningsCents: 7_460_000,
    cpp2RateMicro: 40_000, cpp2MaxPensionableEarningsCents: 8_500_000, eiRateMicro: 16_300, eiRateMicroQuebec: 13_000,
    eiEmployerMultiplierMicro: 1_400_000, eiMaxInsurableEarningsCents: 6_850_000, qpipRateMicro: 4_300, qpipEmployerRateMicro: 6_020,
    qpipMaxInsurableEarningsCents: 9_400_000, qppRateMicro: 63_000, qpp2RateMicro: 40_000, effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
  };
  const input = { grossPayCents: 384_615, payFrequency: "BIWEEKLY" as const, ytdPensionableEarningsCents: 0, ytdCppCents: 0, ytdCpp2Cents: 0, ytdInsurableEarningsCents: 0, ytdEiCents: 0, ytdQpipCents: 0, rates };
  const qc = computeCppAndEi({ ...input, province: "QC" });
  const on = computeCppAndEi({ ...input, province: "ON" });
  check("Payroll: Quebec contributes QPP at its own (higher) rate, still alongside QPIP and Quebec EI", qc.cppCents > on.cppCents && qc.qpipCents > 0 && qc.eiCents < on.eiCents, `QC ${money(qc.cppCents)} QPP / ${money(qc.qpipCents)} QPIP, ON ${money(on.cppCents)} CPP`);
  check("Payroll: Ontario has no QPIP", on.qpipCents === 0, money(on.qpipCents));
  const hourly = { compensationType: "HOURLY", payRateCents: 4_500, payFrequency: "BIWEEKLY", standardHoursPerWeek: 40, employeeType: "FULL_TIME" };
  check("Payroll: an hourly employee defaults to a full period of hours and rate x hours", defaultPeriodHours(hourly) === 80 && hourlyRegularPayCents(hourly, 80) === 360_000, `80h x $45 = ${money(hourlyRegularPayCents(hourly, 80) ?? 0)}`);
  check("Payroll: a casual employee has no default hours", defaultPeriodHours({ ...hourly, employeeType: "CASUAL" }) === null, "hours entered each run");

  // ── Final ledger integrity ────────────────────────────────────────────────
  const integrity = await checkLedgerIntegrity(db, companyId);
  check("Ledger: debits = credits after all of the above", integrity.balanced && integrity.equationGapCents === 0, `${money(integrity.debits)} / ${money(integrity.credits)}`);

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  —  ${r.detail}`);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
