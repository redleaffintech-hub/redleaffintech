-- 15 Sep 2026 review implementation — foundations migration.
-- Purely additive: new nullable/defaulted columns, two new indexes, two new
-- nullable FKs. No existing column is dropped, narrowed, or renamed, so no
-- existing row or posted document is rewritten by this migration.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "creditNoteFooter" TEXT,
ADD COLUMN     "customerCodePadding" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "customerCodePrefix" TEXT NOT NULL DEFAULT 'CUST-',
ADD COLUMN     "gstHstStatus" TEXT NOT NULL DEFAULT 'UNSET',
ADD COLUMN     "nextCustomerCodeNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "pstStatus" TEXT NOT NULL DEFAULT 'UNSET',
ADD COLUMN     "qstStatus" TEXT NOT NULL DEFAULT 'UNSET',
ADD COLUMN     "quoteFooter" TEXT;

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "footerText" TEXT,
ADD COLUMN     "sourceBillId" TEXT,
ADD COLUMN     "sourceInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "CreditNoteLine" ADD COLUMN     "discountAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountMode" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "sourceBillLineId" TEXT,
ADD COLUMN     "sourceInvoiceLineId" TEXT,
ADD COLUMN     "unitCostCents" INTEGER;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "displayCode" TEXT,
ADD COLUMN     "gstExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pstExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Estimate" ADD COLUMN     "billToCity" TEXT,
ADD COLUMN     "billToCountry" TEXT,
ADD COLUMN     "billToLine1" TEXT,
ADD COLUMN     "billToLine2" TEXT,
ADD COLUMN     "billToName" TEXT,
ADD COLUMN     "billToPostalCode" TEXT,
ADD COLUMN     "billToProvince" TEXT,
ADD COLUMN     "footerText" TEXT,
ADD COLUMN     "shipToCity" TEXT,
ADD COLUMN     "shipToCountry" TEXT,
ADD COLUMN     "shipToLine1" TEXT,
ADD COLUMN     "shipToLine2" TEXT,
ADD COLUMN     "shipToName" TEXT,
ADD COLUMN     "shipToPostalCode" TEXT,
ADD COLUMN     "shipToProvince" TEXT;

-- AlterTable
ALTER TABLE "EstimateLine" ADD COLUMN     "discountAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountMode" TEXT NOT NULL DEFAULT 'PERCENT';

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "sourceLineId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "footerText" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "discountAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discountMode" TEXT NOT NULL DEFAULT 'PERCENT';

-- CreateIndex
CREATE INDEX "CreditNote_companyId_sourceInvoiceId_idx" ON "CreditNote"("companyId", "sourceInvoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_companyId_sourceBillId_idx" ON "CreditNote"("companyId", "sourceBillId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_companyId_displayCode_key" ON "Customer"("companyId", "displayCode");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_convertedInvoiceId_key" ON "Estimate"("convertedInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_estimateId_key" ON "Invoice"("estimateId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_sourceInvoiceId_fkey" FOREIGN KEY ("sourceInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_sourceBillId_fkey" FOREIGN KEY ("sourceBillId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
