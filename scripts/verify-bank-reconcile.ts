/**
 * Reconciliation by date (requirement #12), end to end on a throwaway company:
 * the client's example (statement 1000, outstanding +60 / -160, GL 900, difference 0),
 * the date guard, carry-forward of the opening balance and of outstanding items,
 * no reuse of matched ids, and close blocked at a non-zero difference.
 * Local/dev DB only.
 */
import "./load-env";
import { db } from "../src/lib/db";
import { provisionCompany } from "../src/server/setup/provision";
import { postManualJournal } from "../src/server/accounting/journals";
import {
  buildWorkspace, completeReconciliation, getOrStartReconciliation, matchSelected, saveStatementBalances,
} from "../src/server/banking/reconcile";
import { toUtcDay } from "../src/lib/dates";

let failures = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + d}`); if (!ok) failures++; };
async function throws(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return (e as Error).message; }
}

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("Local database only.");
  const co = await db.$transaction(
    (tx) => provisionCompany(tx, { name: "ZZ Recon Probe", legalName: "ZZ", province: "ON", country: "CA", baseCurrency: "CAD", fiscalYearStartMonth: 1, plan: "BASIC", billingCycle: "MONTHLY" } as never),
    { timeout: 60000 },
  );
  const companyId = co.id;
  const actor = await db.user.findFirstOrThrow({ select: { id: true } });
  const gl = await db.account.create({ data: { companyId, code: "1090", name: "Probe Bank", type: "ASSET", subtype: "BANK", description: null, isActive: true } });
  const revenue = await db.account.findFirstOrThrow({ where: { companyId, type: "REVENUE" } });
  const expense = await db.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE" } });
  const bank = await db.bankAccount.create({ data: { companyId, accountId: gl.id, name: "Probe Chequing", type: "BANK", currency: "CAD" } });

  const deposit = (date: string, cents: number, memo: string) =>
    postManualJournal({ companyId, date, memo, lines: [{ accountId: gl.id, debitCents: cents }, { accountId: revenue.id, creditCents: cents }] });
  const payment = (date: string, cents: number, memo: string) =>
    postManualJournal({ companyId, date, memo, lines: [{ accountId: expense.id, debitCents: cents }, { accountId: gl.id, creditCents: cents }] });

  // GL: +1200 and -200 appear on the statement; +60 and -160 do not. GL balance 900.
  await deposit("2026-06-05", 120_000, "Deposit A");
  await payment("2026-06-10", 20_000, "Payment A");
  await deposit("2026-06-28", 6_000, "Deposit in transit");
  await payment("2026-06-29", 16_000, "Cheque outstanding");

  const stmt = async (date: string, cents: number, description: string) =>
    db.bankTransaction.create({ data: { companyId, bankAccountId: bank.id, date: toUtcDay(date), description, normalizedDesc: description.toUpperCase(), amountCents: cents } });
  const sDep = await stmt("2026-06-05", 120_000, "Deposit A");
  const sPay = await stmt("2026-06-10", -20_000, "Payment A");

  // First reconciliation: opening entered by hand (0), closing per statement 1000.00.
  const r1 = await getOrStartReconciliation(companyId, { bankAccountId: bank.id, date: toUtcDay("2026-06-30"), openingBalanceCents: 0, closingBalanceCents: 100_000 });
  check("reconciliation is stored against the chosen date", r1.statementDate.toISOString().startsWith("2026-06-30"));
  let ws = await buildWorkspace(companyId, r1.id);
  check("statement balance is valid: 0 + 1200 credits − 200 debits = 1000", ws.summary.statementBalanceValid && ws.summary.statementCreditsCents === 120_000 && ws.summary.statementDebitsCents === 20_000);
  check("cannot close before matching", !ws.summary.canComplete);

  const lines = await db.journalLine.findMany({ where: { companyId, accountId: gl.id }, orderBy: { date: "asc" } });
  const gDep = lines[0], gPay = lines[1];
  await matchSelected(companyId, r1.id, [sDep.id], [gDep.id]);
  const reuse = await throws(() => matchSelected(companyId, r1.id, [sDep.id], [lines[2].id]));
  check("a matched statement line cannot be matched again", !!reuse, "no error");
  const mismatch = await throws(() => matchSelected(companyId, r1.id, [sPay.id], [gDep.id]));
  check("unequal totals are refused", !!mismatch, "no error");
  await matchSelected(companyId, r1.id, [sPay.id], [gPay.id]);

  ws = await buildWorkspace(companyId, r1.id);
  const s = ws.summary;
  check("client example: statement 1000.00", s.closingBalanceCents === 100_000);
  check("client example: outstanding receipts +60.00", s.outstandingReceiptsCents === 6_000, String(s.outstandingReceiptsCents));
  check("client example: outstanding payments 160.00 (shown −160.00)", s.outstandingPaymentsCents === 16_000, String(s.outstandingPaymentsCents));
  check("client example: GL balance 900.00", s.bookBalanceCents === 90_000, String(s.bookBalanceCents));
  check("client example: difference 0", s.differenceCents === 0 && s.canComplete, String(s.differenceCents));

  await completeReconciliation(companyId, r1.id, s.version, actor.id);
  const done = await db.bankReconciliation.findUniqueOrThrow({ where: { id: r1.id } });
  check("completed and frozen", done.status === "COMPLETED" && !!done.reportJson);
  const reconciled = await db.bankTransaction.count({ where: { companyId, status: "RECONCILED" } });
  check("matched statement lines are marked reconciled", reconciled === 2, String(reconciled));

  // Date guard.
  const early = await throws(() => getOrStartReconciliation(companyId, { bankAccountId: bank.id, date: toUtcDay("2026-06-15") }));
  check("a date on or before the last reconciliation is refused", !!early && /already reconciled/.test(early), String(early));

  // Second reconciliation: opening carried forward, still editable; outstanding items carry over.
  const r2 = await getOrStartReconciliation(companyId, { bankAccountId: bank.id, date: toUtcDay("2026-07-31"), closingBalanceCents: 100_000 });
  check("second reconciliation pre-fills opening from the last closing", r2.openingBalanceCents === 100_000);
  const ws2 = await buildWorkspace(companyId, r2.id);
  check("last time's outstanding items carry forward and it balances: 1000 + 60 − 160 = 900", ws2.summary.differenceCents === 0 && ws2.summary.canComplete, String(ws2.summary.differenceCents));
  await saveStatementBalances(companyId, r2.id, { openingBalanceCents: 99_000, closingBalanceCents: 100_000 });
  const edited = await buildWorkspace(companyId, r2.id);
  check("the carried-forward opening can be edited (and then fails the statement check)", edited.summary.openingBalanceCents === 99_000 && !edited.summary.statementBalanceValid);
  await saveStatementBalances(companyId, r2.id, { openingBalanceCents: 100_000, closingBalanceCents: 100_000 });

  // A bank-only line (on the statement, never booked) leaves a difference, and closing is blocked.
  // (An unmatched GL line cannot: it is an outstanding item and moves both sides together.)
  await stmt("2026-07-20", 500, "Bank fee never booked");
  await saveStatementBalances(companyId, r2.id, { openingBalanceCents: 100_000, closingBalanceCents: 100_500 });
  const blocked = await throws(async () => completeReconciliation(companyId, r2.id, (await buildWorkspace(companyId, r2.id)).summary.version, actor.id));
  check("closing is refused at a non-zero difference", !!blocked && /not zero/.test(blocked), String(blocked));

  // More than one reconciliation in a month is allowed (different dates).
  const r3 = await getOrStartReconciliation(companyId, { bankAccountId: bank.id, date: toUtcDay("2026-07-15"), openingBalanceCents: 100_000 });
  check("two reconciliations in the same month are allowed", r3.id !== r2.id);

  console.log("note: 'ZZ Recon Probe' company left in the local database.");
  console.log(failures ? `\n${failures} FAILED` : "\nAll bank reconciliation checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
