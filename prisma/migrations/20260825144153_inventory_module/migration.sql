-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "trackInventory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "quantityOnHandMilli" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "averageCostCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "quantityMilli" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "totalCostCents" INTEGER NOT NULL,
    "quantityOnHandAfterMilli" INTEGER NOT NULL,
    "averageCostAfterCents" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceNumber" TEXT,
    "journalEntryId" TEXT,
    "memo" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryMovement_companyId_itemId_date_idx" ON "InventoryMovement"("companyId", "itemId", "date");

-- CreateIndex
CREATE INDEX "InventoryMovement_companyId_sourceType_sourceId_idx" ON "InventoryMovement"("companyId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
