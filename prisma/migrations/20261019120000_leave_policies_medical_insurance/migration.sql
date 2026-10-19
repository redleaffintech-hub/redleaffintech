-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "medicalInsuranceAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "medicalInsuranceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "medicalInsuranceFrequency" TEXT NOT NULL DEFAULT 'EVERY_PAY',
ADD COLUMN     "medicalInsuranceMethod" TEXT NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "medicalInsurancePercentMicro" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "medicalInsurancePolicy" TEXT;

-- AlterTable
ALTER TABLE "PayRunLine" ADD COLUMN     "medicalInsuranceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sickHours" DOUBLE PRECISION,
ADD COLUMN     "statutoryHolidayHours" DOUBLE PRECISION,
ADD COLUMN     "vacationHours" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "LeaveBalanceAdjustment" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "expiresOn" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'ADJUSTMENT',
ADD COLUMN     "leaveYear" INTEGER;

-- CreateTable
CREATE TABLE "LeavePolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "entitlementUnit" TEXT NOT NULL DEFAULT 'WEEKS',
    "entitlementAmount" DOUBLE PRECISION NOT NULL,
    "hoursPerDay" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "daysPerWeek" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "accrualMethod" TEXT NOT NULL DEFAULT 'FRONT_LOADED',
    "leaveYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "eligibleEmployeeTypes" TEXT NOT NULL DEFAULT 'FULL_TIME,PART_TIME,CASUAL,SEASONAL,CONTRACT',
    "waitingPeriodDays" INTEGER NOT NULL DEFAULT 0,
    "prorationMethod" TEXT NOT NULL DEFAULT 'DAYS',
    "carryForwardEnabled" BOOLEAN NOT NULL DEFAULT false,
    "carryForwardMaxHours" DOUBLE PRECISION,
    "carryForwardExpiryMonths" INTEGER,
    "excessHandling" TEXT NOT NULL DEFAULT 'FORFEIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeavePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeavePolicy_leaveTypeId_key" ON "LeavePolicy"("leaveTypeId");

-- CreateIndex
CREATE INDEX "LeavePolicy_companyId_idx" ON "LeavePolicy"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveBalanceAdjustment_companyId_dedupeKey_key" ON "LeaveBalanceAdjustment"("companyId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeavePolicy" ADD CONSTRAINT "LeavePolicy_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
