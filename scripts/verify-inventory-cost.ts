/**
 * Used-vehicle costing example: buy a car for $15,000, add repair/detailing/fuel/
 * inspection/other costs, sell it, and check quantity, carrying value and COGS.
 * The main run is one transaction that is rolled back; only the final void check commits a small
 * fixture, so run it against a scratch database:
 *   node --conditions=react-server --import tsx scripts/verify-inventory-cost.ts
 */

import "./load-env"; // must precede any import that reads process.env
import { db } from "../src/lib/db";
import { toUtcDay } from "../src/lib/dates";
import { SYSTEM_ACCOUNTS } from "../src/lib/enums";
import { getSystemAccount } from "../src/server/accounting/ledger";
import { addInventoryCost, adjustStock, consumeStock, reverseInventoryCost } from "../src/server/inventory/costing";
import { createBill, createBillInTx, postBillInTx, voidBill } from "../src/server/documents/bills";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => results.push({ name, pass, detail });
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
class Rollback extends Error {}

async function main() {
  const company = await db.company.findFirstOrThrow({ where: { archivedAt: null, isReadOnly: false } });
  const companyId = company.id;
  const date = toUtcDay(new Date());

  try {
    await db.$transaction(async (tx) => {
      const bank = await tx.account.findFirstOrThrow({ where: { companyId, type: "ASSET", subtype: "BANK" } });
      const invAsset = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.INVENTORY_ASSET);
      const item = await tx.serviceItem.create({
        data: { companyId, type: "PRODUCT", code: `CIVIC-${Date.now()}`, name: "Honda Civic 2022", unit: "each", trackInventory: true, vin: "VIN-123456" },
      });

      const inventoryBalance = async () => {
        const a = await tx.journalLine.aggregate({
          where: { companyId, accountId: invAsset.id },
          _sum: { debitCents: true, creditCents: true },
        });
        return (a._sum.debitCents ?? 0) - (a._sum.creditCents ?? 0);
      };
      const reload = () => tx.serviceItem.findUniqueOrThrow({ where: { id: item.id } });
      const glStart = await inventoryBalance();

      // Purchase: 1 car at $15,000.
      await adjustStock(tx, { companyId, itemId: item.id, date, quantityMilli: 1000, unitCostCents: 1_500_000, offsetAccountId: bank.id, reason: "Vehicle purchase" });
      let i = await reload();
      check("purchase: quantity 1", i.quantityOnHandMilli === 1000, String(i.quantityOnHandMilli));
      check("purchase: cost $15,000", i.averageCostCents === 1_500_000, money(i.averageCostCents));

      // Additional costs.
      const costs: [string, number][] = [
        ["Mechanical repairs", 50_000],
        ["Detailing / car wash", 10_000],
        ["Fuel", 7_500],
        ["Safety inspection", 15_000],
        ["Other qualifying costs", 17_500],
      ];
      let firstCostMovementId = "";
      for (const [category, amountCents] of costs) {
        const r = await addInventoryCost(tx, { companyId, itemId: item.id, date, amountCents, category, supplierName: "ABC Auto Repair", reference: "Invoice #123", offsetAccountId: bank.id });
        if (!firstCostMovementId) firstCostMovementId = r.movement.id;
      }
      i = await reload();
      check("after costs: quantity still 1", i.quantityOnHandMilli === 1000, String(i.quantityOnHandMilli));
      check("after costs: carrying cost $16,000", i.averageCostCents === 1_600_000, money(i.averageCostCents));
      check("GL inventory rose by $16,000", (await inventoryBalance()) - glStart === 1_600_000, money((await inventoryBalance()) - glStart));

      // Reversing one cost removes only that cost, and cannot be done twice.
      await reverseInventoryCost(tx, { companyId, movementId: firstCostMovementId });
      i = await reload();
      check("reverse $500 repair: cost $15,500", i.averageCostCents === 1_550_000, money(i.averageCostCents));
      check("reverse: quantity unchanged", i.quantityOnHandMilli === 1000);
      let doubleReverseBlocked = false;
      try {
        await tx.$executeRaw`SAVEPOINT dbl`;
        await reverseInventoryCost(tx, { companyId, movementId: firstCostMovementId });
      } catch {
        doubleReverseBlocked = true;
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT dbl`;
      }
      check("a cost cannot be reversed twice", doubleReverseBlocked);
      await addInventoryCost(tx, { companyId, itemId: item.id, date, amountCents: 50_000, category: "Mechanical repairs", offsetAccountId: bank.id });
      i = await reload();
      check("re-added repair: back to $16,000", i.averageCostCents === 1_600_000, money(i.averageCostCents));

      // A cost entered as a BILL (the "+ Add cost" form): supplier invoice, tax, AP. Own item so the
      // numbers above stay untouched.
      const car2 = await tx.serviceItem.create({
        data: { companyId, type: "PRODUCT", code: `CAR2-${Date.now()}`, name: "Toyota Corolla 2021", unit: "each", trackInventory: true },
      });
      await adjustStock(tx, { companyId, itemId: car2.id, date, quantityMilli: 1000, unitCostCents: 1_000_000, offsetAccountId: bank.id, reason: "Vehicle purchase" });
      const vendor = await tx.vendor.findFirstOrThrow({ where: { companyId } });
      const expense = await tx.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } });
      const ap = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE);
      const apNet = async () => {
        const a = await tx.journalLine.aggregate({ where: { companyId, accountId: ap.id }, _sum: { creditCents: true, debitCents: true } });
        return (a._sum.creditCents ?? 0) - (a._sum.debitCents ?? 0);
      };
      const apBefore = await apNet();
      const glBeforeBill = await inventoryBalance();
      const costBill = await createBillInTx(tx, {
        companyId, vendorId: vendor.id, issueDate: date, inventoryCostItemId: car2.id,
        lines: [{ accountId: expense.id, description: "Paint touch-up", quantityMilli: 1000, unitPriceCents: 20_000, taxCodeId: null, itemId: null }],
      });
      check("cost bill lines are forced onto the item and flagged cost-only",
        costBill.lines.every((l) => l.itemId === car2.id && l.isInventoryCost), JSON.stringify(costBill.lines.map((l) => [l.itemId, l.isInventoryCost])));
      await postBillInTx(tx, costBill.id, companyId);
      const c2 = await tx.serviceItem.findUniqueOrThrow({ where: { id: car2.id } });
      check("cost bill: quantity still 1", c2.quantityOnHandMilli === 1000, String(c2.quantityOnHandMilli));
      check("cost bill: carrying cost $10,200", c2.averageCostCents === 1_020_000, money(c2.averageCostCents));
      check("cost bill: Accounts Payable up $200", (await apNet()) - apBefore === 20_000, money((await apNet()) - apBefore));
      check("cost bill: GL inventory up $200", (await inventoryBalance()) - glBeforeBill === 20_000, money((await inventoryBalance()) - glBeforeBill));

      // A cost-only bill is refused for an item that is not an inventory product.
      const gap = await tx.serviceItem.create({ data: { companyId, type: "PRODUCT", code: `GAP2-${Date.now()}`, name: "Warranty", unit: "each", trackInventory: false } });
      let billRefused = false;
      try {
        await tx.$executeRaw`SAVEPOINT billnoninv`;
        await createBillInTx(tx, { companyId, vendorId: vendor.id, issueDate: date, inventoryCostItemId: gap.id, lines: [{ accountId: expense.id, description: "x", quantityMilli: 1000, unitPriceCents: 100, taxCodeId: null, itemId: null }] });
      } catch {
        billRefused = true;
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT billnoninv`;
      }
      check("cost bill refused on a non-inventory product", billRefused);

      // Sale relieves the whole $16,000 through COGS.
      const sale = await consumeStock(tx, { companyId, itemId: item.id, date, quantityMilli: 1000, sourceType: "INVOICE" });
      i = await reload();
      check("sale: COGS $16,000", sale.totalCostCents === 1_600_000, money(sale.totalCostCents));
      check("sale: quantity 0", i.quantityOnHandMilli === 0, String(i.quantityOnHandMilli));

      // No stock left on that date: a cost cannot attach to nothing.
      let blocked = false;
      try {
        await tx.$executeRaw`SAVEPOINT nostock`;
        await addInventoryCost(tx, { companyId, itemId: item.id, date, amountCents: 1_000, category: "Late cost", offsetAccountId: bank.id });
      } catch {
        blocked = true;
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT nostock`;
      }
      check("cost refused when nothing is in stock", blocked);

      // A non-inventory product is refused.
      const service = await tx.serviceItem.create({ data: { companyId, type: "PRODUCT", code: `GAP-${Date.now()}`, name: "GAP Warranty", unit: "each", trackInventory: false } });
      let nonInvBlocked = false;
      try {
        await tx.$executeRaw`SAVEPOINT noninv`;
        await addInventoryCost(tx, { companyId, itemId: service.id, date, amountCents: 1_000, category: "x", offsetAccountId: bank.id });
      } catch {
        nonInvBlocked = true;
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT noninv`;
      }
      check("cost refused on a non-inventory product", nonInvBlocked);

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  // Voiding a cost bill takes its cost back out (own committed run: voidBill opens its own transaction;
  // use a scratch database).
  {
    const bank = await db.account.findFirstOrThrow({ where: { companyId, type: "ASSET", subtype: "BANK" } });
    const vendor = await db.vendor.findFirstOrThrow({ where: { companyId } });
    const expense = await db.account.findFirstOrThrow({ where: { companyId, type: "EXPENSE", isActive: true } });
    const car = await db.serviceItem.create({ data: { companyId, type: "PRODUCT", code: `VOIDT-${Date.now()}`, name: "Void test car", unit: "each", trackInventory: true } });
    await db.$transaction((tx) => adjustStock(tx, { companyId, itemId: car.id, date, quantityMilli: 1000, unitCostCents: 500_000, offsetAccountId: bank.id, reason: "Vehicle purchase" }));
    const bill = await createBill({
      companyId, vendorId: vendor.id, issueDate: date, post: true, inventoryCostItemId: car.id,
      lines: [{ accountId: expense.id, description: "Detailing", quantityMilli: 1000, unitPriceCents: 10_000, taxCodeId: null, itemId: null }],
    });
    let v = await db.serviceItem.findUniqueOrThrow({ where: { id: car.id } });
    check("void test: cost raised the carrying cost to $5,100", v.averageCostCents === 510_000, money(v.averageCostCents));
    await voidBill(bill.id, companyId);
    v = await db.serviceItem.findUniqueOrThrow({ where: { id: car.id } });
    check("void test: voiding the cost bill restores $5,000", v.averageCostCents === 500_000, money(v.averageCostCents));
    check("void test: quantity still 1", v.quantityOnHandMilli === 1000, String(v.quantityOnHandMilli));
  }

  let failed = 0;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass || !r.detail ? "" : `  (${r.detail})`}`);
    if (!r.pass) failed++;
  }
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll inventory cost checks passed (one small void-test fixture is left behind: use a scratch database).");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
