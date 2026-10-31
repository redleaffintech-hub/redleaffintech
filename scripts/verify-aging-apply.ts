/**
 * Regression: a receipt recorded unapplied and applied LATER TODAY must leave the
 * A/R aging immediately (the allocation used to carry a timestamp that sorted
 * after the report's midnight "as of" date). Local/dev DB only.
 */
import "./load-env";
import { db } from "../src/lib/db";
import { provisionCompany } from "../src/server/setup/provision";
import { createInvoice } from "../src/server/documents/invoices";
import { recordPayment, applyPayment } from "../src/server/documents/payments";
import { arAging } from "../src/server/reports/aging";
import { today } from "../src/lib/dates";

async function main() {
  if (/neon\.tech/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run against Neon/production.");
  const co = await db.$transaction((tx) => provisionCompany(tx, { name: "ZZ Aging Probe", legalName: "ZZ", province: "ON", country: "CA", baseCurrency: "CAD", fiscalYearStartMonth: 1, plan: "BASIC", billingCycle: "MONTHLY" } as never), { timeout: 60000 });
  const cust = await db.customer.create({ data: { companyId: co.id, name: "Probe Cust" } });
  const bank = await db.account.findFirstOrThrow({ where: { companyId: co.id, subtype: "BANK" } });
  const revenue = await db.account.findFirstOrThrow({ where: { companyId: co.id, type: "REVENUE" } });
  const t = today();
  const inv = await createInvoice({ companyId: co.id, customerId: cust.id, issueDate: t, dueDate: t, lines: [{ accountId: revenue.id, description: "x", quantityMilli: 1000, unitPriceCents: 10000, taxCodeId: null }], post: true } as never);
  const open = async () => (await arAging(co.id, t)).totals.totalCents;
  const before = await open();
  const pay = await recordPayment({ companyId: co.id, type: "RECEIPT", date: t, customerId: cust.id, bankAccountId: bank.id, amountCents: 10000, method: "EFT", allocations: [] });
  const unapplied = await open();
  await applyPayment(co.id, pay.id, [{ invoiceId: inv.id, amountCents: 10000 }]);
  const after = await open();
  const ok = before === 10000 && unapplied === 0 && after === 0;
  console.log(`before=${before} afterUnappliedReceipt=${unapplied} afterApply=${after}  ->  ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
