/**
 * Used-vehicle costing example: buy a car for $15,000, add repair/detailing/fuel/
 * inspection/other costs, sell it, and check quantity, carrying value and COGS.
 * Everything runs inside one transaction that is rolled back, so it leaves no data:
 *   node --conditions=react-server --import tsx scripts/verify-inventory-cost.ts
 */

import "./load-env"; // must precede any import that reads process.env
import { db } from "../src/lib/db";
import { toUtcDay } from "../src/lib/dates";
import { SYSTEM_ACCOUNTS } from "../src/lib/enums";
import { getSystemAccount } from "../src/server/accounting/ledger";
import { addInventoryCost, adjustStock, consumeStock, reverseInventoryCost } from "../src/server/inventory/costing";

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

  let failed = 0;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass || !r.detail ? "" : `  (${r.detail})`}`);
    if (!r.pass) failed++;
  }
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll inventory cost checks passed (rolled back, no data left).");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
