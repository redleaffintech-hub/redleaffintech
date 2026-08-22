-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "shipToCity" TEXT,
ADD COLUMN     "shipToCountry" TEXT,
ADD COLUMN     "shipToLine1" TEXT,
ADD COLUMN     "shipToLine2" TEXT,
ADD COLUMN     "shipToPostalCode" TEXT,
ADD COLUMN     "shipToProvince" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billToCity" TEXT,
ADD COLUMN     "billToCountry" TEXT,
ADD COLUMN     "billToLine1" TEXT,
ADD COLUMN     "billToLine2" TEXT,
ADD COLUMN     "billToName" TEXT,
ADD COLUMN     "billToPostalCode" TEXT,
ADD COLUMN     "billToProvince" TEXT,
ADD COLUMN     "shipToCity" TEXT,
ADD COLUMN     "shipToCountry" TEXT,
ADD COLUMN     "shipToLine1" TEXT,
ADD COLUMN     "shipToLine2" TEXT,
ADD COLUMN     "shipToName" TEXT,
ADD COLUMN     "shipToPostalCode" TEXT,
ADD COLUMN     "shipToProvince" TEXT;
