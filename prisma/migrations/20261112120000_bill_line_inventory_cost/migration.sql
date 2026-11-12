-- Cost-only bill lines: capitalise a supplier cost onto an inventory item without adding stock.
-- Additive: one boolean column defaulting to false.

ALTER TABLE "BillLine" ADD COLUMN "isInventoryCost" BOOLEAN NOT NULL DEFAULT false;
