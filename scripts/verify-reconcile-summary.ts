/**
 * The client's worked example for the reconciliation summary (requirement #12):
 * statement 1000, outstanding +60, outstanding payments −160, GL 900, difference 0.
 * Pure maths, no database.
 */
import { reconciliationBridge, statementBalanceCents } from "../src/lib/reconcile-summary";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failed++;
}

// Amounts in integer cents.
const example = reconciliationBridge({
  statementBalanceCents: 100_000,
  outstandingReceiptsCents: 6_000,
  outstandingPaymentsCents: 16_000,
  glBalanceCents: 90_000,
});
check("statement balance 1000.00", example.statementBalanceCents === 100_000);
check("outstanding receipts +60.00", example.outstandingReceiptsCents === 6_000);
check("outstanding payments -160.00", example.outstandingPaymentsSignedCents === -16_000);
check("adjusted bank balance 900.00", example.adjustedBankBalanceCents === 90_000, String(example.adjustedBankBalanceCents));
check("GL balance 900.00", example.glBalanceCents === 90_000);
check("difference 0", example.differenceCents === 0, String(example.differenceCents));

const off = reconciliationBridge({
  statementBalanceCents: 100_000,
  outstandingReceiptsCents: 6_000,
  outstandingPaymentsCents: 16_000,
  glBalanceCents: 90_001,
});
check("one cent out is a non-zero difference", off.differenceCents === -1, String(off.differenceCents));

// Statement balance = opening + credits − debits (a deposit is a bank credit).
check("opening 500 + credits 700 − debits 200 = 1000", statementBalanceCents(50_000, 70_000, 20_000) === 100_000);

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll reconciliation summary checks passed.");
