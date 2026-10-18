/**
 * Weighted-average inventory costing.
 *
 * Perpetual moving average, evaluated in EFFECTIVE-DATE order (same-day ties
 * broken by posting order), not entry order. After every movement the item's
 * whole history is replayed (`replayItem`), so a backdated purchase or sale
 * re-costs every later sale and corrects the ledger by the difference.
 * A purchase re-averages the cost; a sale leaves it alone.
 * `ServiceItem.quantityOnHandMilli` and `.averageCostCents` are the current
 * state; `InventoryMovement` is the trail that state is rebuilt from, which is
 * what a valuation report reconciles against and what a void reverses.
 *
 * Selling more than is on hand is allowed rather than blocked — quantity can
 * go negative, the same soft-warn-don't-block posture this app takes with a
 * missing provincial tax code. Blocking a sale because of a stock-count
 * mismatch would be a bigger product decision than this module is scoped for.
 */

import type { Tx } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { getSystemAccount, postJournal } from "@/server/accounting/ledger";
import { toUtcDay } from "@/lib/dates";

export interface StockMovementInput {
  companyId: string;
  itemId: string;
  date: Date;
  quantityMilli: number;
  sourceType: string;
  sourceId?: string | null;
  /** The originating BillLine/InvoiceLine/CreditNoteLine id (issue 10, 15 Sep
   * 2026 review) — lets a later return find the exact movement it reverses
   * even when the same item appears on more than one line of a document. */
  sourceLineId?: string | null;
  sourceNumber?: string | null;
  journalEntryId?: string | null;
  memo?: string | null;
  userId?: string | null;
}

async function loadItem(tx: Tx, companyId: string, itemId: string) {
  const item = await tx.serviceItem.findFirst({
    where: { id: itemId, companyId },
    select: { id: true, quantityOnHandMilli: true, averageCostCents: true },
  });
  if (!item) throw new Error("Item not found in this company.");
  return item;
}

/**
 * The GL account each item's stock lives in: the item's own Purchase/inventory
 * account when that is an ASSET account (e.g. 1451), otherwise the company's
 * default Inventory Asset (1450). One rule, used by bills, sales, returns and
 * adjustments alike, so stock received into an account is always taken out of
 * the same account.
 */
export async function inventoryAccountsForItems(tx: Tx, companyId: string, itemIds: string[]) {
  const fallback = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.INVENTORY_ASSET);
  const ids = [...new Set(itemIds)];
  const items = ids.length
    ? await tx.serviceItem.findMany({
        where: { id: { in: ids }, companyId },
        select: { id: true, expenseAccount: { select: { id: true, type: true } } },
      })
    : [];
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.id, item.expenseAccount?.type === "ASSET" ? item.expenseAccount.id : fallback.id);
  }
  return { fallbackId: fallback.id, accountOf: (itemId: string) => map.get(itemId) ?? fallback.id };
}

/**
 * A purchase: quantity in at a known total cost. The weighted average is
 * recomputed by the replay — `newAvg = (oldQty*oldAvg + totalCostCents*1000) / newQty`,
 * in milli-units throughout so it matches `quantityMilli`'s own scale.
 */
export async function receiveStock(
  tx: Tx,
  input: StockMovementInput & { totalCostCents: number; type?: "PURCHASE" | "SALE_RETURN" },
) {
  if (input.quantityMilli <= 0) throw new Error("Received quantity must be greater than zero.");
  await loadItem(tx, input.companyId, input.itemId);
  const unitCostCents = Math.round((input.totalCostCents * 1000) / input.quantityMilli);

  const created = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      date: input.date,
      type: input.type ?? "PURCHASE",
      quantityMilli: input.quantityMilli,
      unitCostCents,
      totalCostCents: input.totalCostCents,
      quantityOnHandAfterMilli: 0,
      averageCostAfterCents: 0,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLineId: input.sourceLineId,
      sourceNumber: input.sourceNumber,
      journalEntryId: input.journalEntryId,
      memo: input.memo,
      createdById: input.userId,
    },
  });
  await replayItem(tx, input.companyId, input.itemId, { userId: input.userId });
  return tx.inventoryMovement.findUniqueOrThrow({ where: { id: created.id } });
}

/**
 * A sale: quantity out, costed at the running average in effect on the sale's
 * date — the average itself does not move on a sale, only on the next
 * purchase. Returns the total cost so the caller can post it to COGS.
 */
export async function consumeStock(tx: Tx, input: StockMovementInput) {
  if (input.quantityMilli <= 0) throw new Error("Sold quantity must be greater than zero.");
  await loadItem(tx, input.companyId, input.itemId);

  const created = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      date: input.date,
      type: "SALE",
      quantityMilli: -input.quantityMilli,
      unitCostCents: 0,
      totalCostCents: 0,
      quantityOnHandAfterMilli: 0,
      averageCostAfterCents: 0,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLineId: input.sourceLineId,
      sourceNumber: input.sourceNumber,
      journalEntryId: input.journalEntryId,
      memo: input.memo,
      createdById: input.userId,
    },
  });
  // The new sale's own journal is posted by the caller from the cost returned
  // here; every OTHER sale whose cost moved gets a correcting entry now.
  await replayItem(tx, input.companyId, input.itemId, { skipJournalFor: created.id, userId: input.userId });
  const movement = await tx.inventoryMovement.findUniqueOrThrow({ where: { id: created.id } });
  return { totalCostCents: -movement.totalCostCents, movement };
}

/**
 * Undo one movement — used when its source document is voided. Applies the
 * opposite quantity at the movement's own recorded cost and inserts a
 * reversing entry on the same effective date; the replay then re-derives the
 * running figures around it.
 */
export async function reverseStockMovement(tx: Tx, movementId: string, userId?: string | null) {
  const movement = await tx.inventoryMovement.findUniqueOrThrow({ where: { id: movementId } });
  await loadItem(tx, movement.companyId, movement.itemId);

  const created = await tx.inventoryMovement.create({
    data: {
      companyId: movement.companyId,
      itemId: movement.itemId,
      date: movement.date,
      type: "REVERSAL",
      quantityMilli: -movement.quantityMilli,
      unitCostCents: movement.unitCostCents,
      totalCostCents: -movement.totalCostCents,
      quantityOnHandAfterMilli: 0,
      averageCostAfterCents: 0,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      sourceLineId: movement.sourceLineId,
      sourceNumber: movement.sourceNumber,
      memo: `Reversal of voided ${movement.sourceType.toLowerCase()}${movement.sourceNumber ? ` ${movement.sourceNumber}` : ""}`,
      createdById: userId,
    },
  });
  await replayItem(tx, movement.companyId, movement.itemId, { userId });
  return tx.inventoryMovement.findUniqueOrThrow({ where: { id: created.id } });
}

/**
 * A return TO a vendor (issue 4, 15 Sep 2026 review): reduces quantity and
 * removes value at the ORIGINAL RECEIPT cost being reversed — not today's
 * weighted average (that would be consumeStock, which is right for a sale
 * but wrong here) and not the vendor's credit amount (which can legitimately
 * differ from the original receipt cost if pricing changed since).
 *
 * Any difference between the vendor's actual credit and this reversal amount
 * is the caller's responsibility to post explicitly (to Cost of Goods Sold —
 * see src/server/documents/credit-notes.ts) rather than silently absorbing it
 * into the average, so the journal and inventory value stay reconcilable
 * after intervening sales or purchases at a different price.
 */
export async function returnToVendor(
  tx: Tx,
  input: StockMovementInput & { originalUnitCostCents: number },
) {
  if (input.quantityMilli <= 0) throw new Error("Returned quantity must be greater than zero.");
  await loadItem(tx, input.companyId, input.itemId);

  const reversalValueCents = Math.round((input.quantityMilli * input.originalUnitCostCents) / 1000);

  const created = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      date: input.date,
      type: "PURCHASE_RETURN",
      quantityMilli: -input.quantityMilli,
      unitCostCents: input.originalUnitCostCents,
      totalCostCents: -reversalValueCents,
      quantityOnHandAfterMilli: 0,
      averageCostAfterCents: 0,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLineId: input.sourceLineId,
      sourceNumber: input.sourceNumber,
      journalEntryId: input.journalEntryId,
      memo: input.memo,
      createdById: input.userId,
    },
  });
  await replayItem(tx, input.companyId, input.itemId, { userId: input.userId });
  return tx.inventoryMovement.findUniqueOrThrow({ where: { id: created.id } });
}

/**
 * A manual correction — an opening count, a shrinkage write-off, a recount.
 * Unlike receiveStock/consumeStock (building blocks the bill/invoice posting
 * flows fold into one larger journal entry), this is self-contained: it
 * posts its own Dr/Cr Inventory Asset entry against a chosen offset account,
 * since a standalone adjustment has no other journal to join.
 *
 * Positive `quantityMilli` receives stock at `unitCostCents`; negative
 * consumes it at the item's average on that date (`unitCostCents` is ignored).
 */
export async function adjustStock(
  tx: Tx,
  input: {
    companyId: string;
    itemId: string;
    date: Date | string;
    quantityMilli: number;
    unitCostCents?: number;
    offsetAccountId: string;
    reason: string;
    userId?: string | null;
  },
) {
  if (input.quantityMilli === 0) throw new Error("Enter a non-zero quantity to adjust.");

  const date = toUtcDay(input.date);
  const item = await loadItem(tx, input.companyId, input.itemId);
  const inventoryAsset = { id: (await inventoryAccountsForItems(tx, input.companyId, [input.itemId])).accountOf(input.itemId) };

  const increasing = input.quantityMilli > 0;
  const totalCostCents = increasing
    ? Math.round((input.quantityMilli * (input.unitCostCents ?? 0)) / 1000)
    : Math.round((-input.quantityMilli * (await averageCostOn(tx, input.companyId, item.id, date))) / 1000);
  if (totalCostCents === 0) throw new Error("The adjustment has no value — enter a unit cost.");

  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date,
    memo: `Inventory adjustment — ${input.reason}`,
    sourceType: "ADJUSTMENT",
    createdById: input.userId,
    lines: increasing
      ? [
          { accountId: inventoryAsset.id, debitCents: totalCostCents, description: input.reason },
          { accountId: input.offsetAccountId, creditCents: totalCostCents, description: input.reason },
        ]
      : [
          { accountId: input.offsetAccountId, debitCents: totalCostCents, description: input.reason },
          { accountId: inventoryAsset.id, creditCents: totalCostCents, description: input.reason },
        ],
  });

  const movementInput = {
    companyId: input.companyId,
    itemId: input.itemId,
    date,
    sourceType: "ADJUSTMENT",
    sourceId: entry.id,
    sourceNumber: entry.entryNo,
    journalEntryId: entry.id,
    memo: input.reason,
    userId: input.userId,
  };
  const movement = increasing
    ? await receiveStock(tx, { ...movementInput, quantityMilli: input.quantityMilli, totalCostCents })
    : await recordAdjustmentOut(tx, { ...movementInput, quantityMilli: -input.quantityMilli, totalCostCents });

  return { entry, movement };
}

/** The running average cost in effect at the end of `date` (posting order within the day). */
async function averageCostOn(tx: Tx, companyId: string, itemId: string, date: Date) {
  const last = await tx.inventoryMovement.findFirst({
    where: { companyId, itemId, date: { lte: date } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { averageCostAfterCents: true },
  });
  return last?.averageCostAfterCents ?? 0;
}

/** A negative adjustment: quantity leaves at the value already journalled. */
async function recordAdjustmentOut(tx: Tx, input: StockMovementInput & { totalCostCents: number }) {
  const created = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      date: input.date,
      type: "ADJUSTMENT",
      quantityMilli: -input.quantityMilli,
      unitCostCents: Math.round((input.totalCostCents * 1000) / input.quantityMilli),
      totalCostCents: -input.totalCostCents,
      quantityOnHandAfterMilli: 0,
      averageCostAfterCents: 0,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      journalEntryId: input.journalEntryId,
      memo: input.memo,
      createdById: input.userId,
    },
  });
  await replayItem(tx, input.companyId, input.itemId, { userId: input.userId });
  return tx.inventoryMovement.findUniqueOrThrow({ where: { id: created.id } });
}

/**
 * Rebuild one item's running quantity, value and average cost from its full
 * movement history in effective-date order (same-day ties: posting order).
 *
 * - Stock in and fixed-value outs (purchase return, reversal, adjustment)
 *   keep their recorded cost.
 * - A SALE leaves at the running average immediately before it. When a
 *   backdated movement changes a posted sale's cost, a correcting
 *   Dr COGS / Cr Inventory entry for the difference is posted so the ledger
 *   still equals the inventory valuation.
 * - Quantity may go negative (visible in the on-hand figure, not blocked).
 */
export async function replayItem(
  tx: Tx,
  companyId: string,
  itemId: string,
  opts: { skipJournalFor?: string; userId?: string | null } = {},
) {
  const movements = await tx.inventoryMovement.findMany({
    where: { companyId, itemId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });

  let qty = 0;
  let avg = 0;
  const corrections: { date: Date; deltaCents: number; sourceNumber: string | null; id: string }[] = [];

  for (const m of movements) {
    let totalCost = m.totalCostCents;
    let unitCost = m.unitCostCents;

    if (m.type === "SALE") {
      const out = -m.quantityMilli;
      const cost = Math.round((out * avg) / 1000);
      totalCost = -cost;
      unitCost = avg;
      qty -= out;
      if (m.id !== opts.skipJournalFor && cost !== -m.totalCostCents) {
        corrections.push({ date: m.date, deltaCents: cost + m.totalCostCents, sourceNumber: m.sourceNumber, id: m.id });
      }
    } else {
      const valueBefore = Math.round((qty * avg) / 1000);
      qty += m.quantityMilli;
      const newValue = valueBefore + m.totalCostCents;
      avg = qty > 0 ? Math.round((newValue * 1000) / qty) : m.quantityMilli < 0 ? avg : 0;
    }

    if (
      m.quantityOnHandAfterMilli !== qty ||
      m.averageCostAfterCents !== avg ||
      m.totalCostCents !== totalCost ||
      m.unitCostCents !== unitCost
    ) {
      await tx.inventoryMovement.update({
        where: { id: m.id },
        data: {
          quantityOnHandAfterMilli: qty,
          averageCostAfterCents: avg,
          totalCostCents: totalCost,
          unitCostCents: unitCost,
        },
      });
    }
  }

  await tx.serviceItem.update({ where: { id: itemId }, data: { quantityOnHandMilli: qty, averageCostCents: avg } });

  if (corrections.length > 0) {
    const inventoryAsset = { id: (await inventoryAccountsForItems(tx, companyId, [itemId])).accountOf(itemId) };
    const cogs = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.COST_OF_GOODS_SOLD);
    for (const c of corrections) {
      const amount = Math.abs(c.deltaCents);
      const memo = `Cost recalculation after backdated inventory entry${c.sourceNumber ? ` — ${c.sourceNumber}` : ""}`;
      await postJournal(tx, {
        companyId,
        date: c.date,
        memo,
        sourceType: "COST_ADJUSTMENT",
        sourceId: c.id,
        sourceNumber: c.sourceNumber,
        createdById: opts.userId,
        lines:
          c.deltaCents > 0
            ? [
                { accountId: cogs.id, debitCents: amount, description: "Recalculated cost of sale" },
                { accountId: inventoryAsset.id, creditCents: amount, description: "Recalculated cost of sale" },
              ]
            : [
                { accountId: inventoryAsset.id, debitCents: amount, description: "Recalculated cost of sale" },
                { accountId: cogs.id, creditCents: amount, description: "Recalculated cost of sale" },
              ],
      });
    }
  }
}
