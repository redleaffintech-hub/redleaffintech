import "server-only";

/**
 * Bank transaction categorisation → journal (§11) — Firestore implementation.
 *
 * `categorizeTransaction` books a bank line straight to a GL account (with tax),
 * the common "this £X is office supplies" workflow. Matching a bank line to open
 * invoices/bills, transfer detection and OFX/CSV import are Phase 5f.
 */

import { toUtcDay } from "@/lib/dates";
import { runTransaction } from "@/server/db/companies";
import { bankAccounts, bankTransactions } from "@/server/db/banking";
import { listTaxEntriesForSourceTx, createTaxEntriesTx } from "@/server/db/tax-entries";
import {
  commitPosting,
  planPosting,
  reverseJournal,
} from "@/server/accounting/ledger-fs";
import { findTaxPeriodTx, loadTaxCodesTx, recordTaxEntriesTx } from "@/server/tax/engine-fs";
import { computeDocument, splitPurchaseDebits } from "@/server/documents/lines";

export interface CategorizeInput {
  accountId: string;
  taxCodeId?: string | null;
  vendorId?: string | null;
  customerId?: string | null;
  memo?: string;
  userId?: string | null;
}

export async function categorizeTransaction(
  companyId: string,
  transactionId: string,
  input: CategorizeInput,
) {
  return runTransaction(async (tx) => {
    const transaction = await bankTransactions.getTx(tx, companyId, transactionId);
    if (!transaction) throw new Error("Bank transaction not found in this company.");
    if (transaction.journalEntryId) throw new Error("This transaction is already posted.");

    const bankAccount = await bankAccounts.getTx(tx, companyId, transaction.bankAccountId);
    if (!bankAccount) throw new Error("The transaction's bank account no longer exists.");

    const isOutflow = transaction.amountCents < 0;
    const magnitude = Math.abs(transaction.amountCents);
    const date = toUtcDay(transaction.date);

    const taxCodes = await loadTaxCodesTx(tx, companyId, [input.taxCodeId]);
    const doc = computeDocument(
      [
        {
          accountId: input.accountId,
          description: input.memo ?? transaction.description,
          unitPriceCents: magnitude,
          taxCodeId: input.taxCodeId,
        },
      ],
      taxCodes,
      true, // bank amounts are the real cash figure — tax-inclusive
      date,
    );

    let lines;
    if (isOutflow) {
      const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(doc.lines);
      lines = [
        ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({
          accountId,
          debitCents: cents,
          description: transaction.description,
          vendorId: input.vendorId,
        })),
        ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
          accountId,
          debitCents: cents,
          description: `Input tax credit — ${transaction.description}`,
          vendorId: input.vendorId,
        })),
        { accountId: bankAccount.accountId, creditCents: magnitude, description: transaction.description },
      ];
    } else {
      lines = [
        { accountId: bankAccount.accountId, debitCents: magnitude, description: transaction.description },
        ...doc.lines.map((l) => ({
          accountId: l.accountId,
          creditCents: l.netCents,
          description: transaction.description,
          customerId: input.customerId,
        })),
        ...doc.taxByComponent
          .filter((c) => c.taxCents !== 0 && c.liabilityAccountId)
          .map((c) => ({
            accountId: c.liabilityAccountId!,
            creditCents: c.taxCents,
            description: `${c.name} on deposit`,
          })),
      ];
    }

    const taxPeriod = await findTaxPeriodTx(tx, companyId, date);
    const plan = await planPosting(tx, {
      companyId,
      date,
      memo: input.memo ?? transaction.description,
      sourceType: "BANK",
      sourceId: transaction.id,
      sourceNumber: transaction.reference,
      createdById: input.userId,
      lines,
    });
    const entry = commitPosting(tx, plan);

    for (const line of doc.lines) {
      if (!line.taxCodeId || line.taxComponents.length === 0) continue;
      recordTaxEntriesTx(tx, {
        companyId,
        date,
        direction: isOutflow ? "PURCHASE" : "SALE",
        sourceType: "BANK",
        sourceId: transaction.id,
        sourceNumber: transaction.reference,
        taxCodeId: line.taxCodeId,
        jurisdiction: line.jurisdiction,
        partyName: transaction.description,
        journalEntryId: entry.id,
        taxPeriodId: taxPeriod?.id ?? null,
        components: line.taxComponents,
      });
    }

    bankTransactions.updateTx(tx, companyId, transactionId, {
      status: "CATEGORIZED",
      categoryAccountId: input.accountId,
      journalEntryId: entry.id,
      matchedType: "JOURNAL",
      matchedId: entry.id,
    });

    return { ...transaction, status: "CATEGORIZED", journalEntryId: entry.id };
  });
}

export async function unmatchTransaction(
  companyId: string,
  transactionId: string,
  userId?: string | null,
) {
  return runTransaction(async (tx) => {
    const transaction = await bankTransactions.getTx(tx, companyId, transactionId);
    if (!transaction) throw new Error("Bank transaction not found in this company.");
    if (!transaction.journalEntryId) throw new Error("This transaction is not posted.");

    const taxRows = await listTaxEntriesForSourceTx(tx, companyId, "BANK", transaction.id);

    await reverseJournal(tx, transaction.journalEntryId, {
      companyId,
      memo: `Unmatch bank transaction — ${transaction.description}`,
      userId,
    });
    if (taxRows.length) {
      createTaxEntriesTx(
        tx,
        taxRows.map((t) => ({
          companyId,
          date: t.date,
          direction: t.direction,
          sourceType: "BANK",
          sourceId: transaction.id,
          sourceNumber: `${transaction.reference ?? transaction.description} (unmatch)`,
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

    bankTransactions.updateTx(tx, companyId, transactionId, {
      status: "UNMATCHED",
      categoryAccountId: null,
      journalEntryId: null,
      matchedType: null,
      matchedId: null,
    });

    return { ...transaction, status: "UNMATCHED", journalEntryId: null };
  });
}
