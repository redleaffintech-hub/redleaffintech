-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "archiveReason" TEXT,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT;

-- CreateTable
CREATE TABLE "SubscriptionCompany" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCompany_companyId_key" ON "SubscriptionCompany"("companyId");

-- CreateIndex
CREATE INDEX "SubscriptionCompany_subscriptionId_idx" ON "SubscriptionCompany"("subscriptionId");

-- AddForeignKey
ALTER TABLE "SubscriptionCompany" ADD CONSTRAINT "SubscriptionCompany_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCompany" ADD CONSTRAINT "SubscriptionCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

