/**
 * Bank reconciliation (spec §11, §12 Bank Reconciliation report).
 *
 * The reconciliation is only allowed to complete when
 *   statement closing balance − (opening + cleared movement) = 0
 * which is the check that proves the book balance and the bank agree.
 */

import { db } from "@/lib/db";
import { toUtcDay } from "@/lib/dates";

export interface ReconciliationState {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  statementStartDate: Date;
  statementEndDate: Date;
  openingBalanceCents: number;
  closingBalanceCents: number;
  clearedDepositsCents: number;
  clearedWithdrawalsCents: number;
  clearedCountDeposits: number;
  clearedCountWithdrawals: number;
  clearedBalanceCents: number;
  differenceCents: number;
  status: string;
}

export async function startReconciliation(
  companyId: string,
  input: {
    bankAccountId: string;
    statementStartDate: Date | string;
    statementEndDate: Date | string;
    openingBalanceCents: number;
    closingBalanceCents: number;
  },
) {
  const bankAccount = await db.bankAccount.findFirst({
    where: { id: input.bankAccountId, companyId },
  });
  if (!bankAccount) throw new Error("Bank account not found in this company.");

  const inProgress = await db.bankReconciliation.findFirst({
    where: { companyId, bankAccountId: input.bankAccountId, status: "IN_PROGRESS" },
  });
  if (inProgress) return inProgress;

  return db.bankReconciliation.create({
    data: {
      companyId,
      bankAccountId: input.bankAccountId,
      statementStartDate: toUtcDay(input.statementStartDate),
      statementEndDate: toUtcDay(input.statementEndDate),
      openingBalanceCents: input.openingBalanceCents,
      closingBalanceCents: input.closingBalanceCents,
      differenceCents: input.closingBalanceCents - input.openingBalanceCents,
    },
  });
}

/** Mark or unmark a transaction as cleared against the statement. */
export async function setCleared(companyId: string, reconciliationId: string, transactionIds: string[], cleared: boolean) {
  const reconciliation = await db.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId, status: "IN_PROGRESS" },
  });
  if (!reconciliation) throw new Error("No reconciliation in progress.");

  await db.bankTransaction.updateMany({
    where: { id: { in: transactionIds }, companyId, bankAccountId: reconciliation.bankAccountId },
    data: { reconciliationId: cleared ? reconciliationId : null },
  });
  return recalculate(companyId, reconciliationId);
}

export async function recalculate(companyId: string, reconciliationId: string): Promise<ReconciliationState> {
  const reconciliation = await db.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId },
    include: { bankAccount: true },
  });
  if (!reconciliation) throw new Error("Reconciliation not found in this company.");

  const cleared = await db.bankTransaction.findMany({
    where: { reconciliationId, companyId },
    select: { amountCents: true },
  });

  const deposits = cleared.filter((t) => t.amountCents > 0);
  const withdrawals = cleared.filter((t) => t.amountCents < 0);
  const clearedDepositsCents = deposits.reduce((s, t) => s + t.amountCents, 0);
  const clearedWithdrawalsCents = withdrawals.reduce((s, t) => s + t.amountCents, 0);
  const clearedBalanceCents =
    reconciliation.openingBalanceCents + clearedDepositsCents + clearedWithdrawalsCents;
  const differenceCents = reconciliation.closingBalanceCents - clearedBalanceCents;

  await db.bankReconciliation.update({
    where: { id: reconciliationId },
    data: { clearedBalanceCents, differenceCents },
  });

  return {
    id: reconciliation.id,
    bankAccountId: reconciliation.bankAccountId,
    bankAccountName: reconciliation.bankAccount.name,
    statementStartDate: reconciliation.statementStartDate,
    statementEndDate: reconciliation.statementEndDate,
    openingBalanceCents: reconciliation.openingBalanceCents,
    closingBalanceCents: reconciliation.closingBalanceCents,
    clearedDepositsCents,
    clearedWithdrawalsCents,
    clearedCountDeposits: deposits.length,
    clearedCountWithdrawals: withdrawals.length,
    clearedBalanceCents,
    differenceCents,
    status: reconciliation.status,
  };
}

export async function completeReconciliation(companyId: string, reconciliationId: string, userId: string) {
  const state = await recalculate(companyId, reconciliationId);
  if (state.differenceCents !== 0) {
    throw new Error(
      `Reconciliation is out by $${(Math.abs(state.differenceCents) / 100).toFixed(2)}. Clear the remaining items or record an adjustment before finishing.`,
    );
  }

  return db.$transaction(async (tx) => {
    await tx.bankTransaction.updateMany({
      where: { reconciliationId, companyId },
      data: { status: "RECONCILED" },
    });
    await tx.auditLog.create({
      data: {
        companyId, userId, action: "UPDATE", entityType: "BankReconciliation", entityId: reconciliationId,
        summary: `Reconciled ${state.bankAccountName} to ${state.statementEndDate.toISOString().slice(0, 10)} — difference $0.00`,
      },
    });
    return tx.bankReconciliation.update({
      where: { id: reconciliationId },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: userId, lockedAt: new Date() },
    });
  });
}

/** Book balance per the GL vs the statement, with the outstanding items between. */
export async function reconciliationReport(companyId: string, bankAccountId: string, asOf: Date) {
  const bankAccount = await db.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
    include: { account: true },
  });
  if (!bankAccount) throw new Error("Bank account not found in this company.");

  const ledger = await db.journalLine.aggregate({
    where: { companyId, accountId: bankAccount.accountId, date: { lte: asOf } },
    _sum: { debitCents: true, creditCents: true },
  });
  const bookBalanceCents = (ledger._sum.debitCents ?? 0) - (ledger._sum.creditCents ?? 0);

  const outstanding = await db.bankTransaction.findMany({
    where: { companyId, bankAccountId, date: { lte: asOf }, status: { notIn: ["RECONCILED", "EXCLUDED"] } },
    orderBy: { date: "asc" },
  });

  const lastCompleted = await db.bankReconciliation.findFirst({
    where: { companyId, bankAccountId, status: "COMPLETED" },
    orderBy: { statementEndDate: "desc" },
  });

  return {
    bankAccount,
    bookBalanceCents,
    outstanding,
    outstandingTotalCents: outstanding.reduce((s, t) => s + t.amountCents, 0),
    lastCompleted,
  };
}
