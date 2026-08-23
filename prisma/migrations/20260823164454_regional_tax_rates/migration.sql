-- CreateTable
CREATE TABLE "RegionalTaxRate" (
    "id" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "federalType" TEXT NOT NULL,
    "federalRateMicro" INTEGER NOT NULL,
    "provincialType" TEXT NOT NULL,
    "provincialRateMicro" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegionalTaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegionalTaxRate_province_effectiveFrom_idx" ON "RegionalTaxRate"("province", "effectiveFrom");


-- Seed the initial platform-configured regime for every Canadian province and
-- territory (spec: /admin/regional-tax-rates). cuid()-shaped ids are generated
-- with gen_random_uuid() since this runs as raw SQL, not through Prisma Client;
-- the format does not matter, only that each row has a unique id.
INSERT INTO "RegionalTaxRate"
  ("id", "province", "federalType", "federalRateMicro", "provincialType", "provincialRateMicro", "effectiveFrom", "isActive", "reason")
VALUES
  (gen_random_uuid()::text, 'AB', 'GST', 50000,  'NONE', 0,     '2008-01-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'BC', 'GST', 50000,  'PST',  70000, '2013-04-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'MB', 'GST', 50000,  'RST',  70000, '2019-07-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'NB', 'HST', 150000, 'NONE', 0,     '2016-07-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'NL', 'HST', 150000, 'NONE', 0,     '2016-07-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'NT', 'GST', 50000,  'NONE', 0,     '2008-01-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'NS', 'HST', 140000, 'NONE', 0,     '2025-04-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'NU', 'GST', 50000,  'NONE', 0,     '2008-01-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'ON', 'HST', 130000, 'NONE', 0,     '2010-07-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'QC', 'GST', 50000,  'QST',  99750, '2013-01-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'PE', 'HST', 150000, 'NONE', 0,     '2016-10-01T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'SK', 'GST', 50000,  'PST',  60000, '2017-03-23T00:00:00Z', true, 'Initial platform configuration'),
  (gen_random_uuid()::text, 'YT', 'GST', 50000,  'NONE', 0,     '2008-01-01T00:00:00Z', true, 'Initial platform configuration');
