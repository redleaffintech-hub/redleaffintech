-- Unpaid-leave deduction carried on each pay-run line.
ALTER TABLE "PayRunLine" ADD COLUMN IF NOT EXISTS "unpaidLeaveHours" DOUBLE PRECISION;
ALTER TABLE "PayRunLine" ADD COLUMN IF NOT EXISTS "unpaidLeaveCents" INTEGER NOT NULL DEFAULT 0;
