import "server-only";

import { converter, mapDocs, newId, sub, type Tx } from "./firestore";
import type { InventoryMovement } from "./types";

/**
 * `companies/{companyId}/inventoryMovements/{id}` — append-only quantity/cost
 * trail for tracked items (§inventory). Replaces `db.inventoryMovement.*`.
 */

const { decode, encode } = converter<InventoryMovement>(["date", "createdAt"]);
const col = (companyId: string) => sub(companyId, "inventoryMovements");

export async function getMovementTx(
  tx: Tx,
  companyId: string,
  id: string,
): Promise<InventoryMovement | null> {
  const snap = await tx.get(col(companyId).doc(id));
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listMovementsForItem(
  companyId: string,
  itemId: string,
): Promise<InventoryMovement[]> {
  const snap = await col(companyId)
    .where("itemId", "==", itemId)
    .orderBy("date")
    .get();
  return mapDocs(snap, decode);
}

export async function listMovementsForSourceTx(
  tx: Tx,
  companyId: string,
  sourceType: string,
  sourceId: string,
): Promise<InventoryMovement[]> {
  const snap = await tx.get(
    col(companyId).where("sourceType", "==", sourceType).where("sourceId", "==", sourceId),
  );
  return mapDocs(snap, decode);
}

export interface NewMovement {
  companyId: string;
  itemId: string;
  date: Date;
  type: string;
  quantityMilli: number;
  unitCostCents: number;
  totalCostCents: number;
  quantityOnHandAfterMilli: number;
  averageCostAfterCents: number;
  sourceType: string;
  sourceId?: string | null;
  sourceNumber?: string | null;
  journalEntryId?: string | null;
  memo?: string | null;
  createdById?: string | null;
}

export function createMovementTx(tx: Tx, input: NewMovement): InventoryMovement {
  const row: InventoryMovement = {
    id: newId(),
    ...input,
    sourceId: input.sourceId ?? null,
    sourceNumber: input.sourceNumber ?? null,
    journalEntryId: input.journalEntryId ?? null,
    memo: input.memo ?? null,
    createdById: input.createdById ?? null,
    createdAt: new Date(),
  };
  tx.set(col(input.companyId).doc(row.id), encode(row));
  return row;
}

/** Link movements written before the journal entry existed to that entry. */
export async function linkMovementsToEntryTx(
  tx: Tx,
  companyId: string,
  movementIds: string[],
  journalEntryId: string,
): Promise<void> {
  for (const id of movementIds) {
    tx.update(col(companyId).doc(id), { journalEntryId });
  }
}
