/**
 * Weighted-average inventory costing.
 *
 * One cost per item, recomputed on every purchase and left alone on every
 * sale — the standard "moving average" method. `ServiceItem.quantityOnHandMilli`
 * and `.averageCostCents` are the current state; `InventoryMovement` is the
 * append-only trail that state was built from, which is what a valuation
 * report reconciles against and what a void reverses.
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
 * A purchase: quantity in at a known total cost. Recomputes the weighted
 * average — `newAvg = (oldQty*oldAvg + totalCostCents*1000) / newQty`, done
 * in milli-units throughout so it matches `quantityMilli`'s own scale.
 */
export async function receiveStock(
  tx: Tx,
  input: StockMovementInput & { totalCostCents: number },
) {
  if (input.quantityMilli <= 0) throw new Error("Received quantity must be greater than zero.");
  const item = await loadItem(tx, input.companyId, input.itemId);

  const oldValueCents = Math.round((item.quantityOnHandMilli * item.averageCostCents) / 1000);
  const newValueCents = oldValueCents + input.totalCostCents;
  const newQuantityMilli = item.quantityOnHandMilli + input.quantityMilli;
  const newAverageCostCents = newQuantityMilli > 0 ? Math.round((newValueCents * 1000) / newQuantityMilli) : 0;
  const unitCostCents = Math.round((input.totalCostCents * 1000) / input.quantityMilli);

  await tx.serviceItem.update({
    where: { id: item.id },
    data: { quantityOnHandMilli: newQuantityMilli, averageCostCents: newAverageCostCents },
  });

  return tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      date: input.date,
      type: "PURCHASE",
      quantityMilli: input.quantityMilli,
      unitCostCents,
      totalCostCents: input.totalCostCents,
      quantityOnHandAfterMilli: newQuantityMilli,
      averageCostAfterCents: newAverageCostCents,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      journalEntryId: input.journalEntryId,
      memo: input.memo,
      createdById: input.userId,
    },
  });
}

/**
 * A sale: quantity out, costed at the item's CURRENT average — the average
 * itself does not move on a sale, only on the next purchase. Returns the
 * total cost so the caller can post it to COGS.
 */
export async function consumeStock(tx: Tx, input: StockMovementInput) {
  if (input.quantityMilli <= 0) throw new Error("Sold quantity must be greater than zero.");
  const item = await loadItem(tx, input.companyId, input.itemId);

  const totalCostCents = Math.round((input.quantityMilli * item.averageCostCents) / 1000);
  const newQuantityMilli = item.quantityOnHandMilli - input.quantityMilli;

  await tx.serviceItem.update({
    where: { id: item.id },
    data: { quantityOnHandMilli: newQuantityMilli },
  });

  const movement = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      date: input.date,
      type: "SALE",
      quantityMilli: -input.quantityMilli,
      unitCostCents: item.averageCostCents,
      totalCostCents: -totalCostCents,
      quantityOnHandAfterMilli: newQuantityMilli,
      averageCostAfterCents: item.averageCostCents,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber,
      journalEntryId: input.journalEntryId,
      memo: input.memo,
      createdById: input.userId,
    },
  });

  return { totalCostCents, movement };
}

/**
 * Undo one movement — used when its source document is voided. Applies the
 * opposite quantity at the movement's own recorded unit cost and inserts a
 * reversing entry; deliberately does not attempt to recompute the average
 * cost history between then and now (correct for the common case of voiding
 * shortly after posting, and the same simplification every basic
 * weighted-average system makes).
 */
export async function reverseStockMovement(tx: Tx, movementId: string, userId?: string | null) {
  const movement = await tx.inventoryMovement.findUniqueOrThrow({ where: { id: movementId } });
  const item = await loadItem(tx, movement.companyId, movement.itemId);

  const reverseQuantityMilli = -movement.quantityMilli;
  const newQuantityMilli = item.quantityOnHandMilli + reverseQuantityMilli;

  await tx.serviceItem.update({
    where: { id: item.id },
    data: { quantityOnHandMilli: newQuantityMilli },
  });

  return tx.inventoryMovement.create({
    data: {
      companyId: movement.companyId,
      itemId: movement.itemId,
      date: movement.date,
      type: "ADJUSTMENT",
      quantityMilli: reverseQuantityMilli,
      unitCostCents: movement.unitCostCents,
      totalCostCents: -movement.totalCostCents,
      quantityOnHandAfterMilli: newQuantityMilli,
      averageCostAfterCents: item.averageCostCents,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      sourceNumber: movement.sourceNumber,
      memo: `Reversal of voided ${movement.sourceType.toLowerCase()}${movement.sourceNumber ? ` ${movement.sourceNumber}` : ""}`,
      createdById: userId,
    },
  });
}

/**
 * A manual correction — an opening count, a shrinkage write-off, a recount.
 * Unlike receiveStock/consumeStock (building blocks the bill/invoice posting
 * flows fold into one larger journal entry), this is self-contained: it
 * posts its own Dr/Cr Inventory Asset entry against a chosen offset account,
 * since a standalone adjustment has no other journal to join.
 *
 * Positive `quantityMilli` receives stock at `unitCostCents`; negative
 * consumes it at the item's current average (`unitCostCents` is ignored).
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
  const inventoryAsset = await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.INVENTORY_ASSET);

  const increasing = input.quantityMilli > 0;
  const totalCostCents = increasing
    ? Math.round((input.quantityMilli * (input.unitCostCents ?? 0)) / 1000)
    : Math.round((-input.quantityMilli * item.averageCostCents) / 1000);
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
    : (await consumeStock(tx, { ...movementInput, quantityMilli: -input.quantityMilli })).movement;

  return { entry, movement };
}
