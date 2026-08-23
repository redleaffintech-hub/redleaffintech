/**
 * Credit notes (spec §8 customer credits, §9 vendor credits).
 *
 * Customer credit             Vendor credit
 *   Dr  Revenue      net        Dr  Accounts Payable  total
 *   Dr  Tax payable  tax          Cr  Expense           net
 *     Cr  A/R          total       Cr  ITC recoverable   tax
 */

import { db, type Tx } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { toUtcDay } from "@/lib/dates";
import { getSystemAccount, postJournal } from "@/server/accounting/ledger";
import { loadTaxCodes, recordTaxEntries } from "@/server/tax/engine";
import { computeDocument, netByAccount, splitPurchaseDebits, type RawLine } from "./lines";
import { nextNumber } from "./numbering";
import { refreshInvoiceStatus } from "./invoices";

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

export async function createCreditNote(input: CreditNoteInput) {
  return db.$transaction(async (tx) => {
    const issueDate = toUtcDay(input.issueDate);
    const taxCodes = await loadTaxCodes(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
    const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);
    const number = await nextNumber(tx, input.companyId, "credit");

    const party =
      input.type === "CUSTOMER"
        ? await tx.customer.findFirst({ where: { id: input.customerId!, companyId: input.companyId } })
        : await tx.vendor.findFirst({ where: { id: input.vendorId!, companyId: input.companyId } });
    if (!party) throw new Error("Customer or vendor not found in this company.");

    const creditNote = await tx.creditNote.create({
      data: {
        companyId: input.companyId,
        type: input.type,
        customerId: input.customerId ?? null,
        vendorId: input.vendorId ?? null,
        number,
        issueDate,
        status: "OPEN",
        reason: input.reason,
        memo: input.memo,
        taxInclusive: input.taxInclusive ?? false,
        subtotalCents: doc.subtotalCents,
        taxCents: doc.taxCents,
        totalCents: doc.totalCents,
        balanceCents: doc.totalCents,
        lines: {
          create: doc.lines.map((l) => ({
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
          })),
        },
      },
      include: { lines: true },
    });

    const journalLines =
      input.type === "CUSTOMER"
        ? [
            ...[...netByAccount(doc.lines).entries()].map(([accountId, net]) => ({
              accountId, debitCents: net, description: `Credit ${number}`, customerId: input.customerId,
            })),
            ...doc.taxByComponent
              .filter((c) => c.taxCents !== 0 && c.liabilityAccountId)
              .map((c) => ({
                accountId: c.liabilityAccountId!, debitCents: c.taxCents,
                description: `${c.name} reversal on ${number}`, customerId: input.customerId,
              })),
            {
              accountId: (await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE)).id,
              creditCents: doc.totalCents,
              description: `${party.name} — ${number}`,
              customerId: input.customerId,
            },
          ]
        : await (async () => {
            const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(doc.lines);
            const ap = await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE);
            return [
              { accountId: ap.id, debitCents: doc.totalCents, description: `${party.name} — ${number}`, vendorId: input.vendorId },
              ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({
                accountId, creditCents: cents, description: `Credit ${number}`, vendorId: input.vendorId,
              })),
              ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
                accountId, creditCents: cents, description: `ITC reversal — ${number}`, vendorId: input.vendorId,
              })),
            ];
          })();

    const entry = await postJournal(tx, {
      companyId: input.companyId,
      date: issueDate,
      memo: `Credit note ${number} — ${party.name}`,
      sourceType: "CREDIT_NOTE",
      sourceId: creditNote.id,
      sourceNumber: number,
      createdById: input.userId,
      lines: journalLines,
    });

    // Negated so tax reports net the credit against the original sale/purchase.
    for (const line of doc.lines) {
      if (!line.taxCodeId || line.taxComponents.length === 0) continue;
      await recordTaxEntries(tx, {
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
        components: line.taxComponents,
        negate: true,
      });
    }

    return tx.creditNote.update({
      where: { id: creditNote.id },
      data: { journalEntryId: entry.id, postedAt: new Date() },
      include: { lines: true },
    });
  });
}

/** Apply an open customer credit against one or more invoices. */
export async function applyCreditNote(
  companyId: string,
  creditNoteId: string,
  allocations: { invoiceId: string; amountCents: number }[],
) {
  return db.$transaction(async (tx) => {
    const credit = await tx.creditNote.findFirst({ where: { id: creditNoteId, companyId } });
    if (!credit) throw new Error("Credit note not found in this company.");

    const requested = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (requested > credit.balanceCents) {
      throw new Error(`Only $${(credit.balanceCents / 100).toFixed(2)} of this credit remains.`);
    }

    await tx.paymentAllocation.createMany({
      data: allocations.map((a) => ({
        creditNoteId,
        invoiceId: a.invoiceId,
        kind: "CREDIT",
        amountCents: a.amountCents,
        date: new Date(),
      })),
    });

    const applied = credit.appliedCents + requested;
    await tx.creditNote.update({
      where: { id: creditNoteId },
      data: {
        appliedCents: applied,
        balanceCents: credit.totalCents - applied,
        status: credit.totalCents - applied <= 0 ? "APPLIED" : "PARTIALLY_APPLIED",
      },
    });

    for (const a of allocations) await refreshInvoiceStatus(tx, a.invoiceId);
    return tx.creditNote.findUnique({ where: { id: creditNoteId } });
  });
}

/** Write an uncollectible invoice off to bad debt (§8). */
export async function writeOffInvoice(
  companyId: string,
  invoiceId: string,
  opts: { date?: Date; reason?: string; userId?: string | null } = {},
) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { customer: true },
    });
    if (!invoice) throw new Error("Invoice not found in this company.");
    if (invoice.balanceCents <= 0) throw new Error("This invoice has no outstanding balance.");

    const badDebt = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.BAD_DEBT_EXPENSE);
    const ar = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE);
    const date = opts.date ? toUtcDay(opts.date) : new Date();

    await postJournal(tx, {
      companyId,
      date,
      memo: opts.reason ?? `Write-off of invoice ${invoice.number}`,
      sourceType: "ADJUSTMENT",
      sourceId: invoice.id,
      sourceNumber: invoice.number,
      createdById: opts.userId,
      lines: [
        { accountId: badDebt.id, debitCents: invoice.balanceCents, description: `Bad debt — ${invoice.customer.name}`, customerId: invoice.customerId },
        { accountId: ar.id, creditCents: invoice.balanceCents, description: `Write-off ${invoice.number}`, customerId: invoice.customerId },
      ],
    });

    // Recorded as an allocation so the aging report can date the write-off and
    // still tie to the A/R control account on any as-of date.
    await tx.paymentAllocation.create({
      data: { invoiceId, kind: "WRITE_OFF", amountCents: invoice.balanceCents, date },
    });

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        writtenOffCents: invoice.writtenOffCents + invoice.balanceCents,
        balanceCents: 0,
        status: "PAID",
      },
    });
  });
}
