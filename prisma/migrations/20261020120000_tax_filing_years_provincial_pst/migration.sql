-- Provincial PST registrations
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "bcPstNumber" TEXT, ADD COLUMN IF NOT EXISTS "mbRstNumber" TEXT, ADD COLUMN IF NOT EXISTS "skPstNumber" TEXT;

-- Map the existing single PST number onto the company's own province, then
-- clear the legacy column only for the rows that were moved (nothing is lost:
-- other provinces keep their value in "pstNumber").
UPDATE "Company" SET "bcPstNumber" = "pstNumber", "pstNumber" = NULL WHERE "province" = 'BC' AND "pstNumber" IS NOT NULL;
UPDATE "Company" SET "mbRstNumber" = "pstNumber", "pstNumber" = NULL WHERE "province" = 'MB' AND "pstNumber" IS NOT NULL;
UPDATE "Company" SET "skPstNumber" = "pstNumber", "pstNumber" = NULL WHERE "province" = 'SK' AND "pstNumber" IS NOT NULL;

-- Year-wise GST/HST filing configuration
CREATE TABLE IF NOT EXISTS "TaxFilingYear" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "applicable" BOOLEAN NOT NULL,
    "frequency" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TaxFilingYear_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaxFilingYear_companyId_year_key" ON "TaxFilingYear"("companyId", "year");
ALTER TABLE "TaxFilingYear" DROP CONSTRAINT IF EXISTS "TaxFilingYear_companyId_fkey";
ALTER TABLE "TaxFilingYear" ADD CONSTRAINT "TaxFilingYear_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from filing periods that already exist, so history keeps its frequency.
INSERT INTO "TaxFilingYear" ("id", "companyId", "year", "applicable", "frequency", "updatedAt")
SELECT 'tfy_' || md5(g."companyId" || g."yr"::text), g."companyId", g."yr", true, g."freq", CURRENT_TIMESTAMP
FROM (
  SELECT "companyId", EXTRACT(YEAR FROM "startDate")::int AS "yr", MIN("frequency") AS "freq"
  FROM "TaxPeriod"
  GROUP BY "companyId", EXTRACT(YEAR FROM "startDate")::int
) g
ON CONFLICT ("companyId", "year") DO NOTHING;
