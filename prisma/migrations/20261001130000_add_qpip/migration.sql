-- AlterTable
ALTER TABLE "PayrollStatutoryRate" ADD COLUMN     "qpipRateMicro" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qpipEmployerRateMicro" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qpipMaxInsurableEarningsCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PayRunLine" ADD COLUMN     "qpipCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "employerQpipCents" INTEGER NOT NULL DEFAULT 0;
