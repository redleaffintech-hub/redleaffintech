-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "nextPayRunNumber" INTEGER NOT NULL DEFAULT 1001,
ADD COLUMN     "payRunPrefix" TEXT NOT NULL DEFAULT 'PR-';

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "payPeriodStart" TIMESTAMP(3) NOT NULL,
    "payPeriodEnd" TIMESTAMP(3) NOT NULL,
    "payDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "bankAccountId" TEXT NOT NULL,
    "memo" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRunLine" (
    "id" TEXT NOT NULL,
    "payRunId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "regularHours" DOUBLE PRECISION,
    "overtimeHours" DOUBLE PRECISION,
    "grossPayCents" INTEGER NOT NULL,
    "cppCents" INTEGER NOT NULL DEFAULT 0,
    "eiCents" INTEGER NOT NULL DEFAULT 0,
    "federalTaxCents" INTEGER NOT NULL DEFAULT 0,
    "provincialTaxCents" INTEGER NOT NULL DEFAULT 0,
    "otherDeductionsCents" INTEGER NOT NULL DEFAULT 0,
    "otherDeductionsNote" TEXT,
    "employerCppCents" INTEGER NOT NULL DEFAULT 0,
    "employerEiCents" INTEGER NOT NULL DEFAULT 0,
    "netPayCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "PayRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_journalEntryId_key" ON "PayRun"("journalEntryId");

-- CreateIndex
CREATE INDEX "PayRun_companyId_status_idx" ON "PayRun"("companyId", "status");

-- CreateIndex
CREATE INDEX "PayRun_companyId_payDate_idx" ON "PayRun"("companyId", "payDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_companyId_number_key" ON "PayRun"("companyId", "number");

-- CreateIndex
CREATE INDEX "PayRunLine_companyId_employeeId_idx" ON "PayRunLine"("companyId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayRunLine_payRunId_employeeId_key" ON "PayRunLine"("payRunId", "employeeId");

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRun" ADD CONSTRAINT "PayRun_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRunLine" ADD CONSTRAINT "PayRunLine_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRunLine" ADD CONSTRAINT "PayRunLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayRunLine" ADD CONSTRAINT "PayRunLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

