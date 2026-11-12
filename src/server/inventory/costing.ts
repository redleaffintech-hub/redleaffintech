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
import { getSystemAccount, postJournal, reverseJournal } from "@/server/accounting/ledger";
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
export async function reverseStockMovement(tx: Tx, movementId: string, userId?: string | null, memo?: string) {
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
      memo: memo ?? `Reversal of voided ${movement.sourceType.toLowerCase()}${movement.sourceNumber ? ` ${movement.sourceNumber}` : ""}`,
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
    /** Journal and movement source; "OPENING" marks an opening-stock entry that can later be edited. */
    sourceType?: "ADJUSTMENT" | "OPENING";
  },
) {
  if (input.quantityMilli === 0) throw new Error("Enter a non-zero quantity to adjust.");
  const sourceType = input.sourceType ?? "ADJUSTMENT";

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
    memo: `${sourceType === "OPENING" ? "Opening stock" : "Inventory adjustment"} — ${input.reason}`,
    sourceType,
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
    sourceType,
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

/**
 * Units in stock on a date, for attaching a cost to. Summed rather than read off
 * the latest movement, so it does not depend on how same-day movements happen
 * to be ordered. Throws when nothing is in stock: capitalising onto nothing
 * would leave value with no quantity behind it.
 */
async function stockOnHandOn(tx: Tx, companyId: string, itemId: string, date: Date) {
  const onHand = await tx.inventoryMovement.aggregate({
    where: { companyId, itemId, date: { lte: date } },
    _sum: { quantityMilli: true },
  });
  const qtyMilli = onHand._sum.quantityMilli ?? 0;
  if (qtyMilli <= 0) {
    throw new Error("There is no stock on hand on that date to add the cost to. Pick a date while the item is in stock.");
  }
  return qtyMilli;
}

/**
 * A cost-only line on a bill: the bill's own journal already debits Inventory,
 * so this records the zero-quantity COST_ADDITION movement that raises the
 * item's carrying value. Quantity does not change.
 */
export async function receiveCostOnly(
  tx: Tx,
  input: StockMovementInput & { totalCostCents: number },
) {
  if (input.totalCostCents <= 0) throw new Error("A cost line needs an amount greater than zero.");
  const item = await tx.serviceItem.findFirst({
    where: { id: input.itemId, companyId: input.companyId },
    select: { trackInventory: true, code: true },
  });
  if (!item) throw new Error("Item not found in this company.");
  if (!item.trackInventory) throw new Error(`${item.code} is not an inventory product, so it cannot carry an additional cost.`);
  const qtyMilli = await stockOnHandOn(tx, input.companyId, input.itemId, input.date);

  const created = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      date: input.date,
      type: "COST_ADDITION",
      quantityMilli: 0,
      unitCostCents: Math.round((input.totalCostCents * 1000) / qtyMilli),
      totalCostCents: input.totalCostCents,
      quantityOnHandAfterMilli: 0,
      averageCostAfterCents: 0,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceLineId: input.sourceLineId,
      sourceNumber: input.sourceNumber,
      journalEntryId: input.journalEntryId,
      memo: input.memo,
      costCategory: "Additional cost",
      createdById: input.userId,
    },
  });
  await replayItem(tx, input.companyId, input.itemId, { userId: input.userId });
  return tx.inventoryMovement.findUniqueOrThrow({ where: { id: created.id } });
}

/**
 * Capitalise an extra cost onto an item already in stock (repairs, detailing,
 * inspection on a used vehicle). Quantity does not change and the original
 * purchase is untouched: a zero-quantity COST_ADDITION movement raises the
 * item's carrying value, so the replay spreads it over the units on hand and a
 * later sale relieves it through COGS. Posts Dr Inventory / Cr the account the
 * cost was paid from (bank or accounts payable).
 */
export async function addInventoryCost(
  tx: Tx,
  input: {
    companyId: string;
    itemId: string;
    date: Date | string;
    amountCents: number;
    category: string;
    supplierName?: string | null;
    reference?: string | null;
    offsetAccountId: string;
    userId?: string | null;
  },
) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Enter a cost greater than zero.");
  const date = toUtcDay(input.date);

  const item = await tx.serviceItem.findFirst({
    where: { id: input.itemId, companyId: input.companyId },
    select: { id: true, trackInventory: true },
  });
  if (!item) throw new Error("Item not found in this company.");
  if (!item.trackInventory) throw new Error("Only an inventory product can carry additional costs.");

  const offset = await tx.account.findFirst({
    where: { id: input.offsetAccountId, companyId: input.companyId, isActive: true },
    select: { id: true, type: true },
  });
  if (!offset) throw new Error("Choose the account the cost was paid from.");
  if (offset.type === "REVENUE") throw new Error("The cost cannot be paid from a revenue account.");

  const qtyMilli = await stockOnHandOn(tx, input.companyId, input.itemId, date);

  const inventoryAsset = { id: (await inventoryAccountsForItems(tx, input.companyId, [input.itemId])).accountOf(input.itemId) };
  const memo = `Additional inventory cost — ${input.category}${input.supplierName ? ` (${input.supplierName})` : ""}`;
  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date,
    memo,
    sourceType: "ADJUSTMENT",
    sourceNumber: input.reference ?? undefined,
    createdById: input.userId,
    lines: [
      { accountId: inventoryAsset.id, debitCents: input.amountCents, description: input.category },
      { accountId: input.offsetAccountId, creditCents: input.amountCents, description: input.category },
    ],
  });

  const created = await tx.inventoryMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      date,
      type: "COST_ADDITION",
      quantityMilli: 0,
      unitCostCents: Math.round((input.amountCents * 1000) / qtyMilli),
      totalCostCents: input.amountCents,
      quantityOnHandAfterMilli: 0,
      averageCostAfterCents: 0,
      sourceType: "COST_ADDITION",
      sourceId: entry.id,
      sourceNumber: input.reference ?? entry.entryNo,
      journalEntryId: entry.id,
      memo,
      costCategory: input.category,
      supplierName: input.supplierName || null,
      createdById: input.userId,
    },
  });
  await replayItem(tx, input.companyId, input.itemId, { userId: input.userId });
  return { entry, movement: await tx.inventoryMovement.findUniqueOrThrow({ where: { id: created.id } }) };
}

/**
 * Undo an additional cost entered by mistake. History is kept: the journal is
 * reversed and an offsetting REVERSAL movement is added, so the cost still shows
 * in the ledger alongside its reversal.
 */
export async function reverseInventoryCost(tx: Tx, input: { companyId: string; movementId: string; userId?: string | null }) {
  const movement = await tx.inventoryMovement.findFirst({
    where: { id: input.movementId, companyId: input.companyId, type: "COST_ADDITION" },
  });
  if (!movement) throw new Error("That cost entry was not found.");
  const alreadyReversed = await tx.inventoryMovement.findFirst({
    where: { companyId: input.companyId, itemId: movement.itemId, type: "REVERSAL", sourceType: "COST_ADDITION", sourceId: movement.sourceId },
    select: { id: true },
  });
  if (alreadyReversed) throw new Error("That cost has already been reversed.");

  if (movement.journalEntryId) {
    await reverseJournal(tx, movement.journalEntryId, {
      companyId: input.companyId,
      memo: `Reversal of additional inventory cost${movement.costCategory ? ` — ${movement.costCategory}` : ""}`,
      userId: input.userId,
    });
  }
  return reverseStockMovement(
    tx,
    movement.id,
    input.userId,
    `Reversal of additional cost${movement.costCategory ? ` — ${movement.costCategory}` : ""}`,
  );
}

/** The live opening-stock entry for an item: an OPENING movement that has not been reversed. */
export async function currentOpeningStock(tx: Tx, companyId: string, itemId: string) {
  const openings = await tx.inventoryMovement.findMany({
    where: { companyId, itemId, sourceType: "OPENING" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const reversed = new Set(openings.filter((m) => m.type === "REVERSAL").map((m) => m.sourceId));
  return openings.find((m) => m.type !== "REVERSAL" && !reversed.has(m.sourceId)) ?? null;
}

/**
 * Set (or edit) an item's opening stock. The first call posts Dr Inventory Asset / Cr Opening
 * Balance Equity. Editing reverses the earlier opening entry and its stock movement, then posts
 * the new figures, so history is kept and the average cost is re-derived. A quantity of 0 just
 * removes the opening stock.
 */
export async function setOpeningStock(
  tx: Tx,
  input: { companyId: string; itemId: string; date: Date | string; quantityMilli: number; unitCostCents: number; userId?: string | null },
) {
  if (input.quantityMilli < 0) throw new Error("Opening quantity cannot be negative.");
  if (input.quantityMilli > 0 && input.unitCostCents <= 0) throw new Error("Enter the unit cost of the opening stock.");

  const existing = await currentOpeningStock(tx, input.companyId, input.itemId);
  if (existing) {
    if (existing.journalEntryId) {
      await reverseJournal(tx, existing.journalEntryId, {
        companyId: input.companyId,
        memo: "Reversal of opening stock being edited",
        userId: input.userId,
      });
    }
    await reverseStockMovement(tx, existing.id, input.userId);
  }
  if (input.quantityMilli === 0) return null;

  const obe = await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY);
  return adjustStock(tx, {
    companyId: input.companyId,
    itemId: input.itemId,
    date: input.date,
    quantityMilli: input.quantityMilli,
    unitCostCents: input.unitCostCents,
    offsetAccountId: obe.id,
    reason: "Opening stock",
    userId: input.userId,
    sourceType: "OPENING",
  });
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
