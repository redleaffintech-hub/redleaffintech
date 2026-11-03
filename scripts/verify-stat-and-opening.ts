/** Stat-holiday worked pay (2x) and editable inventory opening stock. DB work is rolled back. */
import "./load-env";
import { db } from "../src/lib/db";
import { suggestStatHolidayWorkedPayCents } from "../src/server/payroll/tax-engine";
import { currentOpeningStock, setOpeningStock } from "../src/server/inventory/costing";

let failed = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + d}`); if (!ok) failed++; };

const hourly = { compensationType: "HOURLY", payRateCents: 2_000, standardHoursPerWeek: 40, defaultOvertimeRateMultiplierMicro: 1_500_000 };
const salaried = { compensationType: "SALARIED", payRateCents: 5_200_000, standardHoursPerWeek: 40, defaultOvertimeRateMultiplierMicro: null };
check("hourly: 8h on a stat holiday at 20.00/h = 2x = 320.00", suggestStatHolidayWorkedPayCents(hourly, 8) === 32_000);
check("salaried 52,000/yr: 8h = extra 1x premium = 200.00", suggestStatHolidayWorkedPayCents(salaried, 8) === 20_000);
check("zero hours gives zero", suggestStatHolidayWorkedPayCents(hourly, 0) === 0);

class Rollback extends Error {}

async function main() {
  const item = await db.serviceItem.findFirst({ where: { trackInventory: true, quantityOnHandMilli: 0 } })
    ?? await db.serviceItem.findFirst({ where: { trackInventory: true } });
  if (!item) { console.log("SKIP  no tracked inventory item locally"); process.exit(failed ? 1 : 0); }
  const base = item.quantityOnHandMilli;
  const userId = (await db.user.findFirst({ select: { id: true } }))?.id ?? null;

  try {
    await db.$transaction(async (tx) => {
      const input = { companyId: item.companyId, itemId: item.id, date: "2026-01-01", userId };
      await setOpeningStock(tx, { ...input, quantityMilli: 10_000, unitCostCents: 500 });
      let it = await tx.serviceItem.findUniqueOrThrow({ where: { id: item.id } });
      check("opening 10 @ 5.00 adds 10 units", it.quantityOnHandMilli === base + 10_000, String(it.quantityOnHandMilli));
      const first = await currentOpeningStock(tx, item.companyId, item.id);
      check("opening stock is found for editing", first?.quantityMilli === 10_000);

      await setOpeningStock(tx, { ...input, quantityMilli: 4_000, unitCostCents: 700 });
      it = await tx.serviceItem.findUniqueOrThrow({ where: { id: item.id } });
      check("editing to 4 @ 7.00 leaves 4 units from opening", it.quantityOnHandMilli === base + 4_000, String(it.quantityOnHandMilli));
      const second = await currentOpeningStock(tx, item.companyId, item.id);
      check("the live opening entry is the edited one", second?.quantityMilli === 4_000 && second.unitCostCents === 700);

      await setOpeningStock(tx, { ...input, quantityMilli: 0, unitCostCents: 0 });
      it = await tx.serviceItem.findUniqueOrThrow({ where: { id: item.id } });
      check("quantity 0 removes the opening stock", it.quantityOnHandMilli === base && (await currentOpeningStock(tx, item.companyId, item.id)) === null);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) { console.log("FAIL  ", e); failed++; }
  }
  process.exit(failed ? 1 : 0);
}
main();
