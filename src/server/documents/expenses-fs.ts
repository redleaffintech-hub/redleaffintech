import "server-only";

/**
 * Direct expenses (§10) — Firestore implementation.
 *
 *   Dr  Expense account(s)          line net + non-recoverable tax
 *   Dr  GST/HST Recoverable (ITC)   recoverable tax
 *     Cr  Bank / Credit card          total
 */

import { toUtcDay } from "@/lib/dates";
import { recordAudit } from "@/server/db/audit-logs";
import { getAccountsTx } from "@/server/db/accounts";
import { bumpSequenceTx, runTransaction } from "@/server/db/companies";
import { getVendorTx } from "@/server/db/vendors";
import { expenses } from "@/server/db/expenses";
import { createTaxEntriesTx, listTaxEntriesForSourceTx } from "@/server/db/tax-entries";
import type { DocumentLine, Expense } from "@/server/db/types";
import {
  commitPosting,
  planPosting,
  reverseJournal,
} from "@/server/accounting/ledger-fs";
import { findTaxPeriodTx, loadTaxCodesTx, recordTaxEntriesTx } from "@/server/tax/engine-fs";
import { computeDocument, splitPurchaseDebits, type RawLine } from "./lines";

export interface ExpenseInput {
  companyId: string;
  date: Date | string;
  paymentAccountId: string;
  vendorId?: string | null;
  payeeName?: string;
  paymentMethod?: string;
  reference?: string;
  memo?: string;
  taxInclusive?: boolean;
  requiresApproval?: boolean;
  lines: RawLine[];
  bankTransactionId?: string | null;
  userId?: string | null;
  post?: boolean;
}

function toDocumentLines(doc: ReturnType<typeof computeDocument>): DocumentLine[] {
  return doc.lines.map((l) => ({
    lineNo: l.lineNo,
    itemId: null,
    accountId: l.accountId,
    description: l.description,
    quantityMilli: l.quantityMilli,
    unitPriceCents: l.unitPriceCents,
    discountPercentMicro: l.discountPercentMicro,
    netCents: l.netCents,
    taxCodeId: l.taxCodeId ?? null,
    taxCents: l.taxCents,
    totalCents: l.totalCents,
    isBillable: l.isBillable ?? false,
    customerId: l.customerId ?? null,
    projectId: l.projectId ?? null,
  }));
}

export async function createExpense(input: ExpenseInput): Promise<Expense> {
  const draft = await runTransaction(async (tx) => {
    const date = toUtcDay(input.date);
    const paymentAccount = (
      await getAccountsTx(tx, input.companyId, [input.paymentAccountId])
    ).get(input.paymentAccountId);
    if (!paymentAccount) throw new Error("Payment account not found in this company.");

    const taxCodes = await loadTaxCodesTx(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
    const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? true, date);
    const number = await bumpSequenceTx(tx, input.companyId, "expense");

    return expenses.createTx(tx, {
      companyId: input.companyId,
      number,
      date,
      vendorId: input.vendorId ?? null,
      payeeName: input.payeeName ?? null,
      paymentAccountId: input.paymentAccountId,
      paymentMethod: input.paymentMethod ?? "DEBIT",
      reference: input.reference ?? null,
      memo: input.memo ?? null,
      status: input.requiresApproval ? "AWAITING_APPROVAL" : "DRAFT",
      approvalStatus: input.requiresApproval ? "PENDING" : "NOT_REQUIRED",
      approvedById: null,
      approvedAt: null,
      taxInclusive: input.taxInclusive ?? true,
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      journalEntryId: null,
      bankTransactionId: input.bankTransactionId ?? null,
      createdById: input.userId ?? null,
      postedAt: null,
      lines: toDocumentLines(doc),
    } as Partial<Expense> & { companyId: string });
  });

  if (input.post !== false) return postExpense(draft.id, input.companyId, input.userId);
  return draft;
}

export async function postExpense(
  expenseId: string,
  companyId: string,
  userId?: string | null,
): Promise<Expense> {
  return runTransaction(async (tx) => {
    const expense = await expenses.getTx(tx, companyId, expenseId);
    if (!expense) throw new Error("Expense not found in this company.");
    if (expense.journalEntryId) throw new Error(`Expense ${expense.number} is already posted.`);
    if (expense.approvalStatus === "PENDING") throw new Error("This expense needs approval first.");

    const vendor = expense.vendorId ? await getVendorTx(tx, companyId, expense.vendorId) : null;
    const taxCodes = await loadTaxCodesTx(tx, companyId, expense.lines.map((l) => l.taxCodeId));
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
      true,
      expense.date,
    );

    const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(doc.lines);
    const payee = vendor?.name ?? expense.payeeName ?? "Expense";
    const taxPeriod = await findTaxPeriodTx(tx, companyId, expense.date);

    const plan = await planPosting(tx, {
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

    const entry = commitPosting(tx, plan);

    for (const line of doc.lines) {
      if (!line.taxCodeId || line.taxComponents.length === 0) continue;
      recordTaxEntriesTx(tx, {
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
        taxPeriodId: taxPeriod?.id ?? null,
        components: line.taxComponents,
      });
    }

    expenses.updateTx(tx, companyId, expense.id, {
      status: "POSTED",
      journalEntryId: entry.id,
      postedAt: new Date(),
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
    });

    return { ...expense, status: "POSTED", journalEntryId: entry.id };
  });
}

export async function voidExpense(
  expenseId: string,
  companyId: string,
  userId?: string | null,
): Promise<Expense> {
  const result = await runTransaction(async (tx) => {
    const expense = await expenses.getTx(tx, companyId, expenseId);
    if (!expense) throw new Error("Expense not found in this company.");
    if (expense.status === "VOID") throw new Error("Expense is already void.");

    const taxRows = expense.journalEntryId
      ? await listTaxEntriesForSourceTx(tx, companyId, "EXPENSE", expense.id)
      : [];

    if (expense.journalEntryId) {
      await reverseJournal(tx, expense.journalEntryId, {
        companyId,
        memo: `Void expense ${expense.number}`,
        userId,
      });
      if (taxRows.length) {
        createTaxEntriesTx(
          tx,
          taxRows.map((t) => ({
            companyId,
            date: t.date,
            direction: t.direction,
            sourceType: "EXPENSE",
            sourceId: expense.id,
            sourceNumber: `${expense.number} (void)`,
            taxCodeId: t.taxCodeId,
            taxComponentId: t.taxComponentId,
            jurisdiction: t.jurisdiction,
            kind: t.kind,
            rateMicro: t.rateMicro,
            taxableCents: -t.taxableCents,
            taxCents: -t.taxCents,
            recoverableCents: -t.recoverableCents,
            taxPeriodId: t.taxPeriodId,
            partyName: t.partyName,
          })),
        );
      }
    }

    expenses.updateTx(tx, companyId, expenseId, { status: "VOID" });
    return { ...expense, status: "VOID" as const };
  });

  await recordAudit({
    companyId,
    userId: userId ?? null,
    action: "VOID",
    entityType: "Expense",
    entityId: expenseId,
    summary: `Voided expense ${result.number}`,
  });
  return result;
}
