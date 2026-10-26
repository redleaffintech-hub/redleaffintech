ALTER TABLE "Customer" ADD COLUMN "openingBalanceDate" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "openingBalanceDocId" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "openingBalanceDate" TIMESTAMP(3);
ALTER TABLE "Vendor" ADD COLUMN "openingBalanceDocId" TEXT;
