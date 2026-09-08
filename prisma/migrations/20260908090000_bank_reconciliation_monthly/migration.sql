-- Monthly bank-reconciliation workflow.
--
-- Adds the month unit, the carried-forward balance snapshots, a frozen
-- month-end report, an optimistic-concurrency version and a persisted match
-- table. All new columns are nullable or defaulted, so existing rows survive.

-- ── BankReconciliation: month unit + snapshots ──────────────────────────────
ALTER TABLE "BankReconciliation"
  ADD COLUMN "statementYear"  INTEGER,
  ADD COLUMN "statementMonth" INTEGER,
  ADD COLUMN "bookBalanceCents"         INTEGER,
  ADD COLUMN "outstandingReceiptsCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "outstandingPaymentsCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "adjustedBankBalanceCents" INTEGER,
  ADD COLUMN "reportJson"  TEXT,
  ADD COLUMN "notes"       TEXT,
  ADD COLUMN "version"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "startedById" TEXT;

-- Backfill the month unit from the statement end date.
UPDATE "BankReconciliation"
SET "statementYear"  = EXTRACT(YEAR  FROM "statementEndDate")::INTEGER,
    "statementMonth" = EXTRACT(MONTH FROM "statementEndDate")::INTEGER;

-- Collapse any pre-existing duplicates for the same account and month, keeping
-- the most recently created row. Release the other rows' cleared transactions
-- first so nothing is left pointing at a deleted reconciliation.
UPDATE "BankTransaction" bt
SET "reconciliationId" = NULL
FROM "BankReconciliation" br
WHERE bt."reconciliationId" = br."id"
  AND br."id" NOT IN (
    SELECT DISTINCT ON ("companyId", "bankAccountId", "statementYear", "statementMonth") "id"
    FROM "BankReconciliation"
    ORDER BY "companyId", "bankAccountId", "statementYear", "statementMonth", "createdAt" DESC
  );

DELETE FROM "BankReconciliation"
WHERE "id" NOT IN (
  SELECT DISTINCT ON ("companyId", "bankAccountId", "statementYear", "statementMonth") "id"
  FROM "BankReconciliation"
  ORDER BY "companyId", "bankAccountId", "statementYear", "statementMonth", "createdAt" DESC
);

ALTER TABLE "BankReconciliation"
  ALTER COLUMN "statementYear"  SET NOT NULL,
  ALTER COLUMN "statementMonth" SET NOT NULL;

CREATE UNIQUE INDEX "BankReconciliation_account_month_key"
  ON "BankReconciliation" ("companyId", "bankAccountId", "statementYear", "statementMonth");

-- ── BankReconciliationMatch ────────────────────────────────────────────────
CREATE TABLE "BankReconciliationMatch" (
  "id"               TEXT NOT NULL,
  "companyId"        TEXT NOT NULL,
  "reconciliationId" TEXT NOT NULL,
  "bankAccountId"    TEXT NOT NULL,
  "netCents"         INTEGER NOT NULL,
  "statementTxnIds"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "bookLineIds"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"      TEXT,
  CONSTRAINT "BankReconciliationMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankReconciliationMatch_companyId_reconciliationId_idx"
  ON "BankReconciliationMatch" ("companyId", "reconciliationId");
CREATE INDEX "BankReconciliationMatch_companyId_bankAccountId_idx"
  ON "BankReconciliationMatch" ("companyId", "bankAccountId");

ALTER TABLE "BankReconciliationMatch"
  ADD CONSTRAINT "BankReconciliationMatch_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankReconciliationMatch"
  ADD CONSTRAINT "BankReconciliationMatch_reconciliationId_fkey"
  FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
