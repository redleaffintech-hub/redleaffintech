-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "extraSeatPriceCents" INTEGER NOT NULL DEFAULT 499,
ADD COLUMN     "extraSeats" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UserSeatRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestedById" TEXT,
    "extraUsers" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "usersBefore" INTEGER NOT NULL,
    "seatsBefore" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedByEmail" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSeatRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSeatRequest_companyId_status_idx" ON "UserSeatRequest"("companyId", "status");

-- CreateIndex
CREATE INDEX "UserSeatRequest_status_createdAt_idx" ON "UserSeatRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "UserSeatRequest" ADD CONSTRAINT "UserSeatRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
