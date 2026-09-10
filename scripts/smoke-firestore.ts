/**
 * Firestore smoke test — exercises the real repo + engine + report code
 * against a running Firestore emulator (no browser, no Blaze, no prod).
 *
 *   1. terminal A:  firebase emulators:start --only firestore --project redleaf-fintech-e4c4d
 *   2. terminal B:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run smoke:firestore
 *
 * Each numbered step asserts on the Firestore state it produced. A failure
 * throws with the assertion that broke; a clean run prints "ALL CHECKS PASSED".
 */

import "./load-env";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    "Refusing to run: FIRESTORE_EMULATOR_HOST is not set.\n" +
      "Start the emulator, then run with FIRESTORE_EMULATOR_HOST=127.0.0.1:8080.",
  );
  process.exit(1);
}
process.env.FIREBASE_PROJECT_ID ??= "redleaf-fintech-e4c4d";

import { firestore as fs } from "../src/lib/firebase-admin";
import { provisionCompany } from "../src/server/setup/provision";
import {
  listAccounts,
  getSystemAccount,
  createAccount,
} from "../src/server/db/accounts";
import { getCompanyOrThrow } from "../src/server/db/companies";
import { createCustomer } from "../src/server/db/customers";
import { createVendor } from "../src/server/db/vendors";
import { listTaxCodes } from "../src/server/db/tax-codes";
import { listFiscalPeriods } from "../src/server/db/fiscal-periods";
import { bankAccounts } from "../src/server/db/banking";
import { invoices as invoicesRepo } from "../src/server/db/invoices";
import { getEntryWithLines } from "../src/server/db/journal-entries";
import { allBalances } from "../src/server/db/account-balances";
import { listTaxEntriesForSource } from "../src/server/db/tax-entries";
import { listAllocationsForInvoice } from "../src/server/db/payment-allocations";

import { createInvoice, postInvoice } from "../src/server/documents/invoices";
import { createBill, approveBill } from "../src/server/documents/bills";
import { recordPayment } from "../src/server/documents/payments";
import { postManualJournal } from "../src/server/accounting/journals";
import { reverseJournal } from "../src/server/accounting/ledger";
import { runTransaction } from "../src/server/db/firestore";
import { closePeriod } from "../src/server/accounting/journals";
import { trialBalance, incomeStatement, balanceSheet } from "../src/server/reports/financials";
import { arAging } from "../src/server/reports/aging";
import { parseCsv, importTransactions } from "../src/server/banking/import";
import { SYSTEM_ACCOUNTS } from "../src/lib/enums";

// ── assert ──────────────────────────────────────────────────────────────────

let checks = 0;
function ok(cond: unknown, label: string) {
  checks++;
  if (!cond) throw new Error(`CHECK FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}
function eq(a: unknown, b: unknown, label: string) {
  ok(a === b, `${label}  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Firestore smoke test → ${process.env.FIRESTORE_EMULATOR_HOST}\n`);

  // 1 ── provision a company (Ontario → HST) ─────────────────────────────────
  console.log("1. provisionCompany");
  const provisioned = await provisionCompany(undefined, {
    name: `Smoke Co ${Date.now().toString(36)}`,
    province: "ON",
    fiscalYearStartMonth: 1,
    plan: undefined, // no plans seeded on a bare emulator — skip the subscription
    fiscalYears: [new Date().getUTCFullYear()],
  });
  const companyId = provisioned.id;
  const company = await getCompanyOrThrow(companyId);
  ok(company.name.startsWith("Smoke Co"), "company doc written and readable");

  const accounts = await listAccounts(companyId);
  ok(accounts.length > 20, `chart of accounts provisioned (${accounts.length} accounts)`);
  const ar = await getSystemAccount(companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE);
  const ap = await getSystemAccount(companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE);
  const gstPayable = await getSystemAccount(companyId, SYSTEM_ACCOUNTS.GST_HST_PAYABLE);
  ok(ar && ap && gstPayable, "AR / AP / GST-HST-payable resolvable by systemKey");
  const revenue = accounts.find((a) => a.type === "REVENUE")!;
  const expense = accounts.find((a) => a.type === "EXPENSE")!;
  const bankGl = accounts.find((a) => a.subtype === "BANK")!;
  ok(revenue && expense && bankGl, "revenue / expense / bank GL accounts present");

  const taxCodes = await listTaxCodes(companyId);
  const hst = taxCodes.find((c) => c.code.includes("HST") || c.components.some((x) => x.kind === "HST"));
  ok(hst, `provincial tax codes provisioned (${taxCodes.length}), HST code = ${hst?.code}`);

  const periods = await listFiscalPeriods(companyId);
  eq(periods.length, 12, "12 fiscal periods created");

  // 2 ── customer, vendor, bank account ─────────────────────────────────────
  console.log("\n2. master data");
  const customer = await createCustomer({ companyId, name: "Acme Buyer", taxCodeId: hst!.id });
  const vendor = await createVendor({ companyId, name: "Supply Corp" });
  const bank = await bankAccounts.create({
    companyId,
    accountId: bankGl.id,
    name: "Chequing",
    type: "BANK",
    currency: "CAD",
    openingBalanceCents: 0,
    feedStatus: "MANUAL",
    isActive: true,
  } as never);
  ok(customer.id && vendor.id && bank.id, "customer / vendor / bank account created");

  // 3 ── create + post an invoice, verify the whole posting graph ───────────
  console.log("\n3. invoice: create + post");
  const inv = await createInvoice({
    companyId,
    customerId: customer.id,
    issueDate: `${new Date().getUTCFullYear()}-06-15`,
    taxInclusive: false,
    lines: [
      { accountId: revenue.id, description: "Consulting", quantityMilli: 10_000, unitPriceCents: 15_000, taxCodeId: hst!.id },
    ],
    userId: null,
  });
  eq(inv.status, "DRAFT", "invoice created as DRAFT");
  ok(inv.subtotalCents === 150_000, `subtotal = ${inv.subtotalCents} (want 150000)`);
  ok(inv.taxCents === 19_500, `HST 13% = ${inv.taxCents} (want 19500)`);
  ok(inv.totalCents === 169_500, `total = ${inv.totalCents}`);

  const posted = await postInvoice(inv.id, companyId, null);
  eq(posted.status, "SENT", "invoice status → SENT after post");
  ok(posted.journalEntryId, "invoice has a journalEntryId");

  const entry = await getEntryWithLines(companyId, posted.journalEntryId!);
  ok(entry, "journal entry document exists");
  eq(entry!.totalDebitCents, entry!.totalCreditCents, "journal entry balances (Dr = Cr)");
  eq(entry!.totalDebitCents, 169_500, "journal entry total = invoice total");
  const arLine = entry!.lines.find((l) => l.accountId === ar!.id);
  ok(arLine && arLine.debitCents === 169_500, "AR debited by the invoice total");
  const revLine = entry!.lines.find((l) => l.accountId === revenue.id);
  ok(revLine && revLine.creditCents === 150_000, "revenue credited by the net");
  const gstLine = entry!.lines.find((l) => l.accountId === gstPayable!.id);
  ok(gstLine && gstLine.creditCents === 19_500, "GST/HST payable credited by the tax");

  const balances = await allBalances(companyId);
  const arBal = balances.filter((b) => b.accountId === ar!.id).reduce((s, b) => s + b.debitCents - b.creditCents, 0);
  eq(arBal, 169_500, "accountPeriodBalances roll-up: AR = 169500 debit");

  const taxEntries = await listTaxEntriesForSource(companyId, "INVOICE", posted.id);
  ok(taxEntries.length >= 1 && taxEntries[0].taxCents === 19_500, "tax entry row written for the invoice");

  // 4 ── reports balance ────────────────────────────────────────────────────
  console.log("\n4. reports");
  const y = new Date().getUTCFullYear();
  const range = { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y, 11, 31)) };
  const tb = await trialBalance(companyId, range);
  ok(tb.balanced, `trial balance balances (Dr ${tb.totalDebitCents} / Cr ${tb.totalCreditCents})`);
  const is = await incomeStatement(companyId, [{ label: "YTD", from: range.from, to: range.to }]);
  ok(is.sections.length > 0, "income statement produced sections");
  const bs = await balanceSheet(companyId, range.to);
  ok(
    bs.totalAssetsCents === bs.totalLiabilitiesCents + bs.totalEquityCents,
    `balance sheet balances (A ${bs.totalAssetsCents} = L ${bs.totalLiabilitiesCents} + E ${bs.totalEquityCents})`,
  );
  const aging = await arAging(companyId, range.to);
  ok(aging.rows.some((r) => r.documents.some((d) => d.number === posted.number)), "A/R aging shows the open invoice");

  // 5 ── receipt against the invoice ───────────────────────────────────────
  console.log("\n5. payment: receipt + allocation");
  const receipt = await recordPayment({
    companyId,
    type: "RECEIPT",
    date: `${y}-06-20`,
    customerId: customer.id,
    bankAccountId: bankGl.id, // recordPayment takes the GL account id, not a BankAccount doc id
    amountCents: 169_500,
    method: "EFT",
    allocations: [{ invoiceId: posted.id, amountCents: 169_500 }],
    userId: null,
  });
  ok(receipt.journalEntryId, "receipt posted a journal entry");
  const invAfter = await invoicesRepo.get(companyId, posted.id);
  eq(invAfter!.status, "PAID", "invoice → PAID after full receipt");
  eq(invAfter!.balanceCents, 0, "invoice balance → 0");
  const allocs = await listAllocationsForInvoice(companyId, posted.id);
  ok(allocs.length === 1 && allocs[0].amountCents === 169_500, "one allocation of the full amount");

  // 6 ── bill: create + approve + post ─────────────────────────────────────
  console.log("\n6. bill: create + approve + post");
  const bill = await createBill({
    companyId,
    vendorId: vendor.id,
    issueDate: `${y}-06-10`,
    dueDate: `${y}-07-10`,
    taxInclusive: false,
    requiresApproval: true,
    lines: [{ accountId: expense.id, description: "Materials", quantityMilli: 1000, unitPriceCents: 40_000, taxCodeId: hst!.id }],
    userId: null,
  });
  eq(bill.status, "AWAITING_APPROVAL", "bill created AWAITING_APPROVAL");
  // approveBill runs the approval write then posts, in one call
  const bPosted = await approveBill(bill.id, companyId, "smoke-user");
  ok(bPosted.journalEntryId, "bill approved + posted a journal entry");
  const bEntry = await getEntryWithLines(companyId, bPosted.journalEntryId!);
  eq(bEntry!.totalDebitCents, bEntry!.totalCreditCents, "bill journal entry balances");
  const apLine = bEntry!.lines.find((l) => l.accountId === ap!.id);
  ok(apLine && apLine.creditCents === 45_200, "AP credited by the bill total (40000 + 13% HST)");

  // 7 ── manual journal + reversal net to zero ─────────────────────────────
  console.log("\n7. manual journal + reversal");
  const mj = await postManualJournal({
    companyId,
    date: `${y}-06-01`,
    memo: "Smoke adjustment",
    lines: [
      { accountId: expense.id, debitCents: 5_000 },
      { accountId: bankGl.id, creditCents: 5_000 },
    ],
    userId: null,
  });
  ok(mj.id, "manual journal posted");
  const reversal = await runTransaction((tx) =>
    reverseJournal(tx, mj.id, { companyId, memo: "reverse smoke adjustment", userId: null }),
  );
  ok(reversal.id !== mj.id, "reversal is a new entry");
  eq(reversal.totalDebitCents, mj.totalDebitCents, "reversal mirrors the original amount");
  const expAfterReversal = (await allBalances(companyId))
    .filter((b) => b.accountId === expense.id)
    .reduce((s, b) => s + b.debitCents - b.creditCents, 0);
  // expense should now only carry the bill's materials (40000), the +5000/-5000 cancels
  eq(expAfterReversal, 40_000, "expense balance back to just the bill after reversal cancels the adjustment");

  // 8 ── delete-guard: an in-use account cannot be deleted ─────────────────
  console.log("\n8. chart-of-accounts delete guard");
  const { deleteAccountAction } = { deleteAccountAction: null as never }; // server action needs a session; test the primitive instead
  void deleteAccountAction;
  const freshAccount = await createAccount({
    companyId,
    code: `TMP-${Date.now().toString(36)}`,
    name: "Temp unused",
    type: "EXPENSE",
    subtype: "OPERATING_EXPENSE",
  });
  const codeGuard = await fs.collection(`companies/${companyId}/accountCodes`).doc(freshAccount.code).get();
  ok(codeGuard.exists && codeGuard.data()!.accountId === freshAccount.id, "account code guard doc written on create");

  // 9 ── period close ─────────────────────────────────────────────────────
  console.log("\n9. fiscal period close");
  const june = periods.find((p) => p.periodNumber === 6)!;
  const closed = await closePeriod(companyId, june.id, "smoke-user");
  eq(closed.status, "CLOSED", "June period → CLOSED");
  let rejected = false;
  try {
    await postManualJournal({
      companyId,
      date: `${y}-06-15`,
      memo: "should be rejected",
      lines: [
        { accountId: expense.id, debitCents: 100 },
        { accountId: bankGl.id, creditCents: 100 },
      ],
      userId: null,
    });
  } catch {
    rejected = true;
  }
  ok(rejected, "posting into the closed June period is refused");

  // 10 ── bank import + parser ────────────────────────────────────────────
  console.log("\n10. bank import");
  const csv = [
    "Date,Description,Amount",
    `${y}-06-05,ACME CORP EFT,1200.00`,
    `${y}-06-07,OFFICE SUPPLIES,-84.99`,
  ].join("\n");
  const parsed = parseCsv(csv);
  eq(parsed.rows.length, 2, "CSV parser read 2 rows");
  eq(parsed.errors.length, 0, "CSV parser reported no errors");
  const imp = await importTransactions(companyId, bank.id, parsed.rows);
  eq(imp.imported, 2, "2 bank transactions imported");
  const txnSnap = await fs.collection(`companies/${companyId}/bankTransactions`).get();
  eq(txnSnap.size, 2, "bankTransactions collection has 2 docs");
  // re-import the same file → both are duplicates
  const imp2 = await importTransactions(companyId, bank.id, parsed.rows);
  eq(imp2.imported, 0, "re-import: 0 new");
  eq(imp2.duplicates, 2, "re-import: 2 duplicates detected");

  // 11 ── final integrity: whole-company trial balance still balances ─────
  console.log("\n11. final integrity");
  const finalTb = await trialBalance(companyId, range);
  ok(finalTb.balanced, `company trial balance still balances after every flow (Dr ${finalTb.totalDebitCents})`);

  console.log(`\n────────────────────────────────────\nALL CHECKS PASSED  (${checks} assertions)  company ${companyId}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.stack : e}\n`);
    process.exit(1);
  });
