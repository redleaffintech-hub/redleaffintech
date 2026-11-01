-- Bank reconciliation by an arbitrary date instead of a calendar month.
-- Additive: statementYear/statementMonth/statementStartDate/statementEndDate stay,
-- so completed reconciliations and their frozen reports are untouched.

ALTER TABLE "BankReconciliation"
  ADD COLUMN "statementDate" TIMESTAMP(3),
  ADD COLUMN "statementClosingDate" TIMESTAMP(3);

-- The reconciliation date of every existing row is the end of the period it covered.
UPDATE "BankReconciliation" SET "statementDate" = "statementEndDate";

ALTER TABLE "BankReconciliation" ALTER COLUMN "statementDate" SET NOT NULL;

-- One reconciliation per account per month no longer holds; one per date does.
DROP INDEX "BankReconciliation_account_month_key";

CREATE UNIQUE INDEX "BankReconciliation_account_date_key"
  ON "BankReconciliation"("companyId", "bankAccountId", "statementDate");
