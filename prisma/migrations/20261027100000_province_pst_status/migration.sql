-- Per-province PST/RST collection status (BC PST, MB RST, SK PST).
ALTER TABLE "Company" ADD COLUMN "bcPstStatus" TEXT NOT NULL DEFAULT 'UNSET';
ALTER TABLE "Company" ADD COLUMN "mbRstStatus" TEXT NOT NULL DEFAULT 'UNSET';
ALTER TABLE "Company" ADD COLUMN "skPstStatus" TEXT NOT NULL DEFAULT 'UNSET';

-- Carry the old single status over to each province the company has a number for.
UPDATE "Company" SET "bcPstStatus" = "pstStatus" WHERE "pstStatus" <> 'UNSET' AND "bcPstNumber" IS NOT NULL AND "bcPstNumber" <> '';
UPDATE "Company" SET "mbRstStatus" = "pstStatus" WHERE "pstStatus" <> 'UNSET' AND "mbRstNumber" IS NOT NULL AND "mbRstNumber" <> '';
UPDATE "Company" SET "skPstStatus" = "pstStatus" WHERE "pstStatus" <> 'UNSET' AND "skPstNumber" IS NOT NULL AND "skPstNumber" <> '';
