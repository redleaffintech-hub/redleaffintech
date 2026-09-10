import "server-only";

/**
 * Credit notes (§8 customer credits, §9 vendor credits) and invoice write-off —
 * Firestore implementation. Credit notes post on creation (no draft state).
 */

import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { toUtcDay } from "@/lib/dates";
import { bumpSequenceTx, runTransaction } from "@/server/db/companies";
import { getCustomerTx } from "@/server/db/customers";
import { getVendorTx } from "@/server/db/vendors";
import { creditNotes } from "@/server/db/credit-notes";
import { invoices } from "@/server/db/invoices";
import {
  createAllocationsTx,
  listAllocationsForInvoice,
} from "@/server/db/payment-allocations";
import type { CreditNote, DocumentLine, Invoice } from "@/server/db/types";
import {
  commitPosting,
  getSystemAccount,
  planPosting,
} from "@/server/accounting/ledger";
import { findTaxPeriodTx, loadTaxCodesTx, recordTaxEntriesTx } from "@/server/tax/engine-fs";
import { refreshInvoiceStatusTx } from "./invoices";
import {
  computeDocument,
  netByAccount,
  splitPurchaseDebits,
  type RawLine,
} from "./lines";

export interface CreditNoteInput {
  companyId: string;
  type: "CUSTOMER" | "VENDOR";
  customerId?: string | null;
  vendorId?: string | null;
  issueDate: Date | string;
  reason?: string;
  memo?: string;
  taxInclusive?: boolean;
  lines: RawLine[];
  userId?: string | null;
}

function toDocumentLines(doc: ReturnType<typeof computeDocument>): DocumentLine[] {
  return doc.lines.map((l) => ({
    lineNo: l.lineNo,
    itemId: l.itemId ?? null,
    accountId: l.accountId,
    description: l.description,
    quantityMilli: l.quantityMilli,
    unitPriceCents: l.unitPriceCents,
    discountPercentMicro: l.discountPercentMicro,
    netCents: l.netCents,
    taxCodeId: l.taxCodeId ?? null,
    taxCents: l.taxCents,
    totalCents: l.totalCents,
  }));
}

export async function createCreditNote(input: CreditNoteInput): Promise<CreditNote> {
  return runTransaction(async (tx) => {
    const issueDate = toUtcDay(input.issueDate);

    const party =
      input.type === "CUSTOMER"
        ? await getCustomerTx(tx, input.companyId, input.customerId!)
        : await getVendorTx(tx, input.companyId, input.vendorId!);
    if (!party) throw new Error("Customer or vendor not found in this company.");

    const taxCodes = await loadTaxCodesTx(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
    const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);

    // System accounts needed for the journal — read before any write.
    const ar =
      input.type === "CUSTOMER"
        ? await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE)
        : null;
    const ap =
      input.type === "VENDOR"
        ? await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE)
        : null;
    const taxPeriod = await findTaxPeriodTx(tx, input.companyId, issueDate);

    const number = await bumpSequenceTx(tx, input.companyId, "credit");

    const journalLines =
      input.type === "CUSTOMER"
        ? [
            ...netByAccount(doc.lines).map((entry) => ({
              accountId: entry.accountId,
              debitCents: entry.netCents,
              description: `Credit ${number}`,
              customerId: input.customerId,
              taxCodeId: entry.taxCodeId,
            })),
            ...doc.taxByComponent
              .filter((c) => c.taxCents !== 0 && c.liabilityAccountId)
              .map((c) => ({
                accountId: c.liabilityAccountId!,
                debitCents: c.taxCents,
                description: `${c.name} reversal on ${number}`,
                customerId: input.customerId,
              })),
            {
              accountId: ar!.id,
              creditCents: doc.totalCents,
              description: `${party.name} — ${number}`,
              customerId: input.customerId,
            },
          ]
        : (() => {
            const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(doc.lines);
            return [
              {
                accountId: ap!.id,
                debitCents: doc.totalCents,
                description: `${party.name} — ${number}`,
                vendorId: input.vendorId,
              },
              ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({
                accountId,
                creditCents: cents,
                description: `Credit ${number}`,
                vendorId: input.vendorId,
              })),
              ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
                accountId,
                creditCents: cents,
                description: `ITC reversal — ${number}`,
                vendorId: input.vendorId,
              })),
            ];
          })();

    const creditNote = creditNotes.createTx(tx, {
      companyId: input.companyId,
      type: input.type,
      customerId: input.customerId ?? null,
      vendorId: input.vendorId ?? null,
      number,
      issueDate,
      status: "OPEN",
      reason: input.reason ?? null,
      memo: input.memo ?? null,
      taxInclusive: input.taxInclusive ?? false,
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      appliedCents: 0,
      balanceCents: doc.totalCents,
      journalEntryId: null,
      postedAt: null,
      lines: toDocumentLines(doc),
    } as Partial<CreditNote> & { companyId: string });

    const plan = await planPosting(tx, {
      companyId: input.companyId,
      date: issueDate,
      memo: `Credit note ${number} — ${party.name}`,
      sourceType: "CREDIT_NOTE",
      sourceId: creditNote.id,
      sourceNumber: number,
      createdById: input.userId,
      lines: journalLines,
    });
    const entry = commitPosting(tx, plan);

    for (const line of doc.lines) {
      if (!line.taxCodeId || line.taxComponents.length === 0) continue;
      recordTaxEntriesTx(tx, {
        companyId: input.companyId,
        date: issueDate,
        direction: input.type === "CUSTOMER" ? "SALE" : "PURCHASE",
        sourceType: "CREDIT_NOTE",
        sourceId: creditNote.id,
        sourceNumber: number,
        taxCodeId: line.taxCodeId,
        jurisdiction: line.jurisdiction,
        partyName: party.name,
        journalEntryId: entry.id,
        taxPeriodId: taxPeriod?.id ?? null,
        components: line.taxComponents,
        negate: true,
      });
    }

    creditNotes.updateTx(tx, input.companyId, creditNote.id, {
      journalEntryId: entry.id,
      postedAt: new Date(),
    });

    return { ...creditNote, journalEntryId: entry.id };
  });
}

/** Apply an open customer credit against one or more invoices. */
export async function applyCreditNote(
  companyId: string,
  creditNoteId: string,
  allocations: { invoiceId: string; amountCents: number }[],
): Promise<CreditNote> {
  return runTransaction(async (tx) => {
    const credit = await creditNotes.getTx(tx, companyId, creditNoteId);
    if (!credit) throw new Error("Credit note not found in this company.");

    const requested = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (requested > credit.balanceCents) {
      throw new Error(`Only $${(credit.balanceCents / 100).toFixed(2)} of this credit remains.`);
    }

    // Existing allocations per invoice, for the status recompute.
    const existingByInvoice = new Map<string, { amountCents: number; kind: string }[]>();
    for (const a of allocations) {
      const rows = await listAllocationsForInvoice(companyId, a.invoiceId);
      existingByInvoice.set(
        a.invoiceId,
        rows.map((r) => ({ amountCents: r.amountCents, kind: r.kind })),
      );
    }

    createAllocationsTx(
      tx,
      allocations.map((a) => ({
        companyId,
        creditNoteId,
        invoiceId: a.invoiceId,
        kind: "CREDIT",
        amountCents: a.amountCents,
        date: new Date(),
      })),
    );

    const applied = credit.appliedCents + requested;
    creditNotes.updateTx(tx, companyId, creditNoteId, {
      appliedCents: applied,
      balanceCents: credit.totalCents - applied,
      status: credit.totalCents - applied <= 0 ? "APPLIED" : "PARTIALLY_APPLIED",
    });

    for (const a of allocations) {
      await refreshInvoiceStatusTx(tx, companyId, a.invoiceId, [
        ...(existingByInvoice.get(a.invoiceId) ?? []),
        { amountCents: a.amountCents, kind: "CREDIT" },
      ]);
    }

    return { ...credit, appliedCents: applied };
  });
}

/** Write an uncollectible invoice off to bad debt (§8). */
export async function writeOffInvoice(
  companyId: string,
  invoiceId: string,
  opts: { date?: Date; reason?: string; userId?: string | null } = {},
): Promise<Invoice> {
  return runTransaction(async (tx) => {
    const invoice = await invoices.getTx(tx, companyId, invoiceId);
    if (!invoice) throw new Error("Invoice not found in this company.");
    if (invoice.balanceCents <= 0) throw new Error("This invoice has no outstanding balance.");
    const customer = await getCustomerTx(tx, companyId, invoice.customerId);

    const badDebt = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.BAD_DEBT_EXPENSE);
    const ar = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE);
    const date = opts.date ? toUtcDay(opts.date) : toUtcDay(new Date());

    const plan = await planPosting(tx, {
      companyId,
      date,
      memo: opts.reason ?? `Write-off of invoice ${invoice.number}`,
      sourceType: "ADJUSTMENT",
      sourceId: invoice.id,
      sourceNumber: invoice.number,
      createdById: opts.userId,
      lines: [
        {
          accountId: badDebt.id,
          debitCents: invoice.balanceCents,
          description: `Bad debt — ${customer?.name ?? ""}`,
          customerId: invoice.customerId,
        },
        {
          accountId: ar.id,
          creditCents: invoice.balanceCents,
          description: `Write-off ${invoice.number}`,
          customerId: invoice.customerId,
        },
      ],
    });
    commitPosting(tx, plan);

    createAllocationsTx(tx, [
      {
        companyId,
        invoiceId,
        kind: "WRITE_OFF",
        amountCents: invoice.balanceCents,
        date,
      },
    ]);

    invoices.updateTx(tx, companyId, invoiceId, {
      writtenOffCents: invoice.writtenOffCents + invoice.balanceCents,
      balanceCents: 0,
      status: "PAID",
    });

    return { ...invoice, balanceCents: 0, status: "PAID" as const };
  });
}
