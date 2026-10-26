-- QPP replaces CPP/CPP2 for Quebec employees. Published rates (Retraite Québec / Revenu Québec):
-- 2026: 6.30% (base 5.30% + first additional 1.00%), QPP2 4.00%; 2025: 6.40%, QPP2 4.00%.
ALTER TABLE "PayrollStatutoryRate" ADD COLUMN "qppRateMicro" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayrollStatutoryRate" ADD COLUMN "qpp2RateMicro" INTEGER NOT NULL DEFAULT 0;

-- A rate row that ended before 2026 is a 2025-era row; any row still in force in 2026 gets the 2026 rate.
UPDATE "PayrollStatutoryRate" SET "qppRateMicro" = 64000, "qpp2RateMicro" = 40000
  WHERE "effectiveFrom" >= '2025-01-01' AND "effectiveTo" IS NOT NULL AND "effectiveTo" < '2026-01-01';
UPDATE "PayrollStatutoryRate" SET "qppRateMicro" = 63000, "qpp2RateMicro" = 40000
  WHERE "qppRateMicro" = 0 AND ("effectiveTo" IS NULL OR "effectiveTo" >= '2026-01-01');
