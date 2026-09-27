-- AlterTable
ALTER TABLE "BankReconciliationMatch" ALTER COLUMN "statementTxnIds" DROP DEFAULT,
ALTER COLUMN "bookLineIds" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bankAccountNumberHash" TEXT,
ADD COLUMN     "bankAccountNumberLast4" TEXT,
ADD COLUMN     "bankInstitutionNumber" TEXT,
ADD COLUMN     "bankTransitNumber" TEXT,
ADD COLUMN     "defaultOvertimeRateMultiplierMicro" INTEGER,
ADD COLUMN     "immigrationStatus" TEXT,
ADD COLUMN     "immigrationStatusExpiryDate" TIMESTAMP(3),
ADD COLUMN     "sinExpiryDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PayRunLine" ADD COLUMN     "bonusCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cpp2Cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "employerCpp2Cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otRateMultiplierMicro" INTEGER,
ADD COLUMN     "overtimePayCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "regularPayCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retroactivePayCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sickPayCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "statutoryHolidayPayCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vacationPayCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "EmployeeCompensationChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "previousPayRateCents" INTEGER NOT NULL,
    "newPayRateCents" INTEGER NOT NULL,
    "compensationType" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeCompensationChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollStatutoryRate" (
    "id" TEXT NOT NULL,
    "cppRateMicro" INTEGER NOT NULL,
    "cppBasicExemptionCents" INTEGER NOT NULL,
    "cppMaxPensionableEarningsCents" INTEGER NOT NULL,
    "cpp2RateMicro" INTEGER NOT NULL,
    "cpp2MaxPensionableEarningsCents" INTEGER NOT NULL,
    "eiRateMicro" INTEGER NOT NULL,
    "eiEmployerMultiplierMicro" INTEGER NOT NULL,
    "eiMaxInsurableEarningsCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollStatutoryRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollTaxBracket" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "minCents" INTEGER NOT NULL,
    "maxCents" INTEGER,
    "rateMicro" INTEGER NOT NULL,
    "basicPersonalAmountCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollTaxBracket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeCompensationChange_companyId_employeeId_effectiveDa_idx" ON "EmployeeCompensationChange"("companyId", "employeeId", "effectiveDate");

-- CreateIndex
CREATE INDEX "PayrollStatutoryRate_effectiveFrom_idx" ON "PayrollStatutoryRate"("effectiveFrom");

-- CreateIndex
CREATE INDEX "PayrollTaxBracket_jurisdiction_effectiveFrom_idx" ON "PayrollTaxBracket"("jurisdiction", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "EmployeeCompensationChange" ADD CONSTRAINT "EmployeeCompensationChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeCompensationChange" ADD CONSTRAINT "EmployeeCompensationChange_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
