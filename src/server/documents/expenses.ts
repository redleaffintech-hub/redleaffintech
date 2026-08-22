/**
 * Direct expenses (spec §10) — money that leaves a bank or credit-card account
 * without an intervening vendor bill.
 *
 * Posting rule
 *   Dr  Expense account(s)          line net + non-recoverable tax
 *   Dr  GST/HST Recoverable (ITC)   recoverable tax
 *     Cr  Bank / Credit card          total
 */

import { db, type Tx } from "@/lib/db";
import { toUtcDay } from "@/lib/dates";
import { postJournal, reverseJournal } from "@/server/accounting/ledger";
import { loadTaxCodes, recordTaxEntries } from "@/server/tax/engine";
import { computeDocument, splitPurchaseDebits, type RawLine } from "./lines";
import { nextNumber } from "./numbering";

export interface ExpenseInput {
  companyId: string;
  date: Date | string;
  /** GL account the money came out of — bank, credit card or cash. */
  paymentAccountId: string;
  vendorId?: string | null;
  payeeName?: string;
  paymentMethod?: string;
  reference?: string;
  memo?: string;
  /** Receipts are usually tax-inclusive, so that is the default here. */
  taxInclusive?: boolean;
  requiresApproval?: boolean;
  lines: RawLine[];
  bankTransactionId?: string | null;
  userId?: string | null;
  post?: boolean;
}

export async function createExpense(input: ExpenseInput) {
  return db.$transaction(async (tx) => {
    const expense = await createExpenseInTx(tx, input);
    if (input.post !== false) return postExpenseInTx(tx, expense.id, input.companyId, input.userId);
    return expense;
  });
}

export async function createExpenseInTx(tx: Tx, input: ExpenseInput) {
  const date = toUtcDay(input.date);
  const paymentAccount = await tx.account.findFirst({
    where: { id: input.paymentAccountId, companyId: input.companyId },
  });
  if (!paymentAccount) throw new Error("Payment account not found in this company.");

  const taxCodes = await loadTaxCodes(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
  const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? true, date);
  const number = await nextNumber(tx, input.companyId, "expense");

  return tx.expense.create({
    data: {
      companyId: input.companyId,
      number,
      date,
      vendorId: input.vendorId ?? null,
      payeeName: input.payeeName,
      paymentAccountId: input.paymentAccountId,
      paymentMethod: input.paymentMethod ?? "DEBIT",
      reference: input.reference,
      memo: input.memo,
      status: input.requiresApproval ? "AWAITING_APPROVAL" : "DRAFT",
      approvalStatus: input.requiresApproval ? "PENDING" : "NOT_REQUIRED",
      taxInclusive: input.taxInclusive ?? true,
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      bankTransactionId: input.bankTransactionId ?? null,
      createdById: input.userId ?? null,
      lines: {
        create: doc.lines.map((l) => ({
          lineNo: l.lineNo,
          accountId: l.accountId,
          description: l.description,
          netCents: l.netCents,
          taxCodeId: l.taxCodeId ?? null,
          taxCents: l.taxCents,
          totalCents: l.totalCents,
          isBillable: l.isBillable ?? false,
          customerId: l.customerId ?? null,
          projectId: l.projectId ?? null,
        })),
      },
    },
    include: { lines: true, vendor: true },
  });
}

export async function postExpenseInTx(
  tx: Tx,
  expenseId: string,
  companyId: string,
  userId?: string | null,
) {
  const expense = await tx.expense.findFirst({
    where: { id: expenseId, companyId },
    include: { lines: true, vendor: true },
  });
  if (!expense) throw new Error("Expense not found in this company.");
  if (expense.journalEntryId) throw new Error(`Expense ${expense.number} is already posted.`);
  if (expense.approvalStatus === "PENDING") throw new Error("This expense needs approval first.");

  const taxCodes = await loadTaxCodes(tx, companyId, expense.lines.map((l) => l.taxCodeId));
  const doc = computeDocument(
    expense.lines.map((l) => ({
      accountId: l.accountId,
      description: l.description,
      unitPriceCents: l.netCents + l.taxCents,
      quantityMilli: 1000,
      taxCodeId: l.taxCodeId,
      customerId: l.customerId,
      projectId: l.projectId,
      isBillable: l.isBillable,
    })),
    taxCodes,
    // Line amounts are stored gross here, so recompute in inclusive mode.
    true,
    expense.date,
  );

  const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(doc.lines);
  const payee = expense.vendor?.name ?? expense.payeeName ?? "Expense";

  const entry = await postJournal(tx, {
    companyId,
    date: expense.date,
    memo: `Expense ${expense.number} — ${payee}`,
    sourceType: "EXPENSE",
    sourceId: expense.id,
    sourceNumber: expense.number,
    createdById: userId,
    lines: [
      ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({
        accountId,
        debitCents: cents,
        description: expense.memo ?? payee,
        vendorId: expense.vendorId,
      })),
      ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
        accountId,
        debitCents: cents,
        description: `Input tax credit — ${expense.number}`,
        vendorId: expense.vendorId,
      })),
      {
        accountId: expense.paymentAccountId,
        creditCents: doc.totalCents,
        description: `${payee} — ${expense.number}`,
        vendorId: expense.vendorId,
      },
    ],
  });

  for (const line of doc.lines) {
    if (!line.taxCodeId || line.taxComponents.length === 0) continue;
    await recordTaxEntries(tx, {
      companyId,
      date: expense.date,
      direction: "PURCHASE",
      sourceType: "EXPENSE",
      sourceId: expense.id,
      sourceNumber: expense.number,
      taxCodeId: line.taxCodeId,
      jurisdiction: line.jurisdiction,
      partyName: payee,
      journalEntryId: entry.id,
      components: line.taxComponents,
    });
  }

  return tx.expense.update({
    where: { id: expense.id },
    data: {
      status: "POSTED",
      journalEntryId: entry.id,
      postedAt: new Date(),
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
    },
    include: { lines: true, vendor: true },
  });
}

export async function voidExpense(expenseId: string, companyId: string, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const expense = await tx.expense.findFirst({ where: { id: expenseId, companyId } });
    if (!expense) throw new Error("Expense not found in this company.");
    if (expense.status === "VOID") throw new Error("Expense is already void.");
    if (expense.journalEntryId) {
      await reverseJournal(tx, expense.journalEntryId, {
        companyId, memo: `Void expense ${expense.number}`, userId,
      });
    }
    return tx.expense.update({ where: { id: expenseId }, data: { status: "VOID" } });
  });
}
