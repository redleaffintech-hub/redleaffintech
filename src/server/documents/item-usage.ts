import "server-only";

import { db } from "@/lib/db";

/**
 * How many documents — plus inventory movements, e.g. a manual stock
 * adjustment — reference each catalogue item in a company, batched across
 * every item rather than one at a time.
 *
 * Shared by every screen that lists items and needs to know which ones can be
 * deleted outright (used === 0) versus only archived. Kept in step with
 * `deleteItemAction`'s own per-item count in products-services/actions.ts —
 * a mismatch there would show a Delete button the server then refuses.
 */
export async function itemUsageCounts(companyId: string): Promise<Map<string, number>> {
  const usage = await db.$transaction([
    db.invoiceLine.groupBy({ by: ["itemId"], where: { itemId: { not: null }, invoice: { companyId } }, _count: true, orderBy: { itemId: "asc" } }),
    db.estimateLine.groupBy({ by: ["itemId"], where: { itemId: { not: null }, estimate: { companyId } }, _count: true, orderBy: { itemId: "asc" } }),
    db.creditNoteLine.groupBy({ by: ["itemId"], where: { itemId: { not: null }, creditNote: { companyId } }, _count: true, orderBy: { itemId: "asc" } }),
    db.billLine.groupBy({ by: ["itemId"], where: { itemId: { not: null }, bill: { companyId } }, _count: true, orderBy: { itemId: "asc" } }),
    db.inventoryMovement.groupBy({ by: ["itemId"], where: { companyId }, _count: true, orderBy: { itemId: "asc" } }),
  ]);
  const usedCount = new Map<string, number>();
  for (const group of usage) {
    for (const row of group) {
      if (!row.itemId) continue;
      const n = typeof row._count === "number" ? row._count : 0;
      usedCount.set(row.itemId, (usedCount.get(row.itemId) ?? 0) + n);
    }
  }
  return usedCount;
}
