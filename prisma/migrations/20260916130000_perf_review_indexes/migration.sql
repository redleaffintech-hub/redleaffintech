-- 16 Sep 2026 performance review — indexes only, no data or column changes.
--
-- Extends the existing InventoryMovement(companyId, sourceType, sourceId)
-- index with sourceLineId (a linked return's lookup filters on all four),
-- and adds the two indexes CreditNoteLine.sourceInvoiceLineId/sourceBillLineId
-- were missing — both are queried directly with no other narrowing column.

-- DropIndex
DROP INDEX "InventoryMovement_companyId_sourceType_sourceId_idx";

-- CreateIndex
CREATE INDEX "CreditNoteLine_sourceInvoiceLineId_idx" ON "CreditNoteLine"("sourceInvoiceLineId");

-- CreateIndex
CREATE INDEX "CreditNoteLine_sourceBillLineId_idx" ON "CreditNoteLine"("sourceBillLineId");

-- CreateIndex
CREATE INDEX "InventoryMovement_companyId_sourceType_sourceId_sourceLineI_idx" ON "InventoryMovement"("companyId", "sourceType", "sourceId", "sourceLineId");
