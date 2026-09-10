import "server-only";

/**
 * Weighted-average inventory costing (§inventory) — Firestore implementation.
 *
 * Split into plan (reads) / commit (writes) like the posting engine, because a
 * sale's stock movement rides on the same transaction as the invoice journal and
 * Firestore forbids reads after writes.
 *
 * `receiveStock` / `consumeStock` are building blocks folded into a larger
 * journal by the bill/invoice flows. `adjustStock` (a standalone count/write-off
 * that posts its own entry) stays a single self-contained call.
 */

import { getItem, getTrackedItemsTx, updateItemTx } from "@/server/db/items";
import {
  createMovementTx,
  getMovementTx,
  type NewMovement,
} from "@/server/db/inventory-movements";
import type { Tx } from "@/server/db/firestore";
import type { ServiceItem } from "@/server/db/types";

export interface MovementMeta {
  date: Date;
  sourceType: string;
  sourceId?: string | null;
  sourceNumber?: string | null;
  journalEntryId?: string | null;
  memo?: string | null;
  userId?: string | null;
}

async function loadItemTx(tx: Tx, companyId: string, itemId: string): Promise<ServiceItem> {
  const map = await getTrackedItemsTx(tx, companyId, [itemId]);
  const item = map.get(itemId);
  if (item) return item;
  // Might be an untracked item id passed by mistake, or genuinely missing.
  const any = await getItem(companyId, itemId);
  if (!any) throw new Error("Item not found in this company.");
  return any;
}

// ── Consume (sale) ──────────────────────────────────────────────────────────

export interface ConsumePlan {
  item: ServiceItem;
  quantityMilli: number;
  totalCostCents: number;
  newQuantityMilli: number;
}

export async function planConsumeStock(
  tx: Tx,
  companyId: string,
  itemId: string,
  quantityMilli: number,
): Promise<ConsumePlan> {
  if (quantityMilli <= 0) throw new Error("Sold quantity must be greater than zero.");
  const item = await loadItemTx(tx, companyId, itemId);
  const totalCostCents = Math.round((quantityMilli * item.averageCostCents) / 1000);
  return {
    item,
    quantityMilli,
    totalCostCents,
    newQuantityMilli: item.quantityOnHandMilli - quantityMilli,
  };
}

export function commitConsumeStock(tx: Tx, companyId: string, plan: ConsumePlan, meta: MovementMeta) {
  updateItemTx(tx, companyId, plan.item.id, { quantityOnHandMilli: plan.newQuantityMilli });
  const movement: NewMovement = {
    companyId,
    itemId: plan.item.id,
    date: meta.date,
    type: "SALE",
    quantityMilli: -plan.quantityMilli,
    unitCostCents: plan.item.averageCostCents,
    totalCostCents: -plan.totalCostCents,
    quantityOnHandAfterMilli: plan.newQuantityMilli,
    averageCostAfterCents: plan.item.averageCostCents,
    sourceType: meta.sourceType,
    sourceId: meta.sourceId,
    sourceNumber: meta.sourceNumber,
    journalEntryId: meta.journalEntryId,
    memo: meta.memo,
    createdById: meta.userId,
  };
  return createMovementTx(tx, movement);
}

// ── Receive (purchase) ──────────────────────────────────────────────────────

export interface ReceivePlan {
  item: ServiceItem;
  quantityMilli: number;
  totalCostCents: number;
  newQuantityMilli: number;
  newAverageCostCents: number;
  unitCostCents: number;
}

export async function planReceiveStock(
  tx: Tx,
  companyId: string,
  itemId: string,
  quantityMilli: number,
  totalCostCents: number,
): Promise<ReceivePlan> {
  if (quantityMilli <= 0) throw new Error("Received quantity must be greater than zero.");
  const item = await loadItemTx(tx, companyId, itemId);
  const oldValueCents = Math.round((item.quantityOnHandMilli * item.averageCostCents) / 1000);
  const newValueCents = oldValueCents + totalCostCents;
  const newQuantityMilli = item.quantityOnHandMilli + quantityMilli;
  const newAverageCostCents =
    newQuantityMilli > 0 ? Math.round((newValueCents * 1000) / newQuantityMilli) : 0;
  return {
    item,
    quantityMilli,
    totalCostCents,
    newQuantityMilli,
    newAverageCostCents,
    unitCostCents: Math.round((totalCostCents * 1000) / quantityMilli),
  };
}

export function commitReceiveStock(tx: Tx, companyId: string, plan: ReceivePlan, meta: MovementMeta) {
  updateItemTx(tx, companyId, plan.item.id, {
    quantityOnHandMilli: plan.newQuantityMilli,
    averageCostCents: plan.newAverageCostCents,
  });
  return createMovementTx(tx, {
    companyId,
    itemId: plan.item.id,
    date: meta.date,
    type: "PURCHASE",
    quantityMilli: plan.quantityMilli,
    unitCostCents: plan.unitCostCents,
    totalCostCents: plan.totalCostCents,
    quantityOnHandAfterMilli: plan.newQuantityMilli,
    averageCostAfterCents: plan.newAverageCostCents,
    sourceType: meta.sourceType,
    sourceId: meta.sourceId,
    sourceNumber: meta.sourceNumber,
    journalEntryId: meta.journalEntryId,
    memo: meta.memo,
    createdById: meta.userId,
  });
}

// ── Reverse a movement (void) ───────────────────────────────────────────────

export interface ReverseMovementPlan {
  item: ServiceItem;
  movementId: string;
  companyId: string;
  itemId: string;
  date: Date;
  reverseQuantityMilli: number;
  unitCostCents: number;
  totalCostCents: number;
  newQuantityMilli: number;
  sourceType: string;
  sourceId: string | null;
  sourceNumber: string | null;
}

export async function planReverseMovement(
  tx: Tx,
  companyId: string,
  movementId: string,
): Promise<ReverseMovementPlan> {
  const movement = await getMovementTx(tx, companyId, movementId);
  if (!movement) throw new Error("Inventory movement not found.");
  const item = await loadItemTx(tx, companyId, movement.itemId);
  const reverseQuantityMilli = -movement.quantityMilli;
  return {
    item,
    movementId,
    companyId,
    itemId: movement.itemId,
    date: movement.date,
    reverseQuantityMilli,
    unitCostCents: movement.unitCostCents,
    totalCostCents: -movement.totalCostCents,
    newQuantityMilli: item.quantityOnHandMilli + reverseQuantityMilli,
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    sourceNumber: movement.sourceNumber,
  };
}

export function commitReverseMovement(tx: Tx, plan: ReverseMovementPlan, userId?: string | null) {
  updateItemTx(tx, plan.companyId, plan.item.id, { quantityOnHandMilli: plan.newQuantityMilli });
  return createMovementTx(tx, {
    companyId: plan.companyId,
    itemId: plan.itemId,
    date: plan.date,
    type: "ADJUSTMENT",
    quantityMilli: plan.reverseQuantityMilli,
    unitCostCents: plan.unitCostCents,
    totalCostCents: plan.totalCostCents,
    quantityOnHandAfterMilli: plan.newQuantityMilli,
    averageCostAfterCents: plan.item.averageCostCents,
    sourceType: plan.sourceType,
    sourceId: plan.sourceId,
    sourceNumber: plan.sourceNumber,
    memo: `Reversal of voided ${plan.sourceType.toLowerCase()}${plan.sourceNumber ? ` ${plan.sourceNumber}` : ""}`,
    createdById: userId,
  });
}
