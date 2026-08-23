-- CreateTable
CREATE TABLE "FiscalCalendarChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "previousStartMonth" INTEGER NOT NULL,
    "newStartMonth" INTEGER NOT NULL,
    "effectiveFiscalYear" INTEGER NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "postedEntryCount" INTEGER NOT NULL DEFAULT 0,
    "periodsCreated" INTEGER NOT NULL DEFAULT 0,
    "transitionStart" TIMESTAMP(3),
    "transitionEnd" TIMESTAMP(3),
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalCalendarChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalCalendarChange_companyId_effectiveDate_idx" ON "FiscalCalendarChange"("companyId", "effectiveDate");

-- AddForeignKey
ALTER TABLE "FiscalCalendarChange" ADD CONSTRAINT "FiscalCalendarChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

