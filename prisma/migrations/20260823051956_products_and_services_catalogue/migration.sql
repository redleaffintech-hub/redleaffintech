-- AlterTable
ALTER TABLE "BillLine" ADD COLUMN     "discountPercentMicro" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "itemId" TEXT;

-- AlterTable
ALTER TABLE "CreditNoteLine" ADD COLUMN     "discountPercentMicro" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "itemId" TEXT;

-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "discountPercentMicro" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purchaseTaxCodeId" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'SERVICE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "ServiceItem_companyId_isActive_idx" ON "ServiceItem"("companyId", "isActive");

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_purchaseTaxCodeId_fkey" FOREIGN KEY ("purchaseTaxCodeId") REFERENCES "TaxCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ServiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillLine" ADD CONSTRAINT "BillLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ServiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

