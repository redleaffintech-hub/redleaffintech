/**
 * Customer receipts and vendor payments (spec §8, §9).
 *
 * Receipt (money in)          Payment (money out)
 *   Dr  Bank        amount      Dr  Accounts Payable   amount
 *     Cr  A/R         amount       Cr  Bank              amount
 *
 * Allocation is deliberately separate from the cash posting: an unapplied
 * receipt is still a real credit sitting in the A/R control account, and the
 * A/R aging reports it as a customer credit rather than hiding it.
 */

import { db, type Tx } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { toUtcDay } from "@/lib/dates";
import { getSystemAccount, postJournal, reverseJournal } from "@/server/accounting/ledger";
import { nextNumber } from "./numbering";
import { refreshInvoiceStatus } from "./invoices";
import { refreshBillStatus } from "./bills";

export interface AllocationInput {
  invoiceId?: string;
  billId?: string;
  creditNoteId?: string;
  amountCents: number;
}

export interface PaymentInput {
  companyId: string;
  type: "RECEIPT" | "PAYMENT";
  date: Date | string;
  customerId?: string | null;
  vendorId?: string | null;
  /** GL account the cash moved through. */
  bankAccountId: string;
  amountCents: number;
  method?: string;
  reference?: string;
  memo?: string;
  allocations?: AllocationInput[];
  bankTransactionId?: string | null;
  userId?: string | null;
}

export async function recordPayment(input: PaymentInput) {
  return db.$transaction((tx) => recordPaymentInTx(tx, input));
}

/** A party's open (partially or fully unpaid) documents, oldest due date first, for allocating a payment across. */
export async function openDocumentsForParty(companyId: string, type: "RECEIPT" | "PAYMENT", partyId: string) {
  if (type === "RECEIPT") {
    return db.invoice.findMany({
      where: { companyId, customerId: partyId, balanceCents: { gt: 0 }, status: { notIn: ["DRAFT", "VOID"] } },
      orderBy: { dueDate: "asc" },
      select: { id: true, number: true, issueDate: true, dueDate: true, balanceCents: true },
    });
  }
  return db.bill.findMany({
    where: { companyId, vendorId: partyId, balanceCents: { gt: 0 }, status: { notIn: ["DRAFT", "VOID"] } },
    orderBy: { dueDate: "asc" },
    select: { id: true, number: true, issueDate: true, dueDate: true, balanceCents: true },
  });
}

export async function recordPaymentInTx(tx: Tx, input: PaymentInput) {
  const date = toUtcDay(input.date);
  if (input.amountCents <= 0) throw new Error("Payment amount must be greater than zero.");

  const bankAccount = await tx.account.findFirst({
    where: { id: input.bankAccountId, companyId: input.companyId },
  });
  if (!bankAccount) throw new Error("Bank account not found in this company.");

  const allocations = input.allocations ?? [];
  const allocatedTotal = allocations.reduce((s, a) => s + a.amountCents, 0);
  if (allocatedTotal > input.amountCents) {
    throw new Error("Allocations exceed the payment amount.");
  }

  // Verify every target document belongs to this company and has room left.
  for (const allocation of allocations) {
    if (allocation.amountCents <= 0) throw new Error("Allocation amounts must be positive.");
    if (allocation.invoiceId) {
      const invoice = await tx.invoice.findFirst({
        where: { id: allocation.invoiceId, companyId: input.companyId },
      });
      if (!invoice) throw new Error("Invoice not found in this company.");
      if (invoice.status === "DRAFT") throw new Error(`Invoice ${invoice.number} is not posted yet.`);
      if (allocation.amountCents > invoice.balanceCents) {
        throw new Error(
          `Cannot apply more than the ${invoice.number} balance of $${(invoice.balanceCents / 100).toFixed(2)}.`,
        );
      }
    }
    if (allocation.billId) {
      const bill = await tx.bill.findFirst({
        where: { id: allocation.billId, companyId: input.companyId },
      });
      if (!bill) throw new Error("Bill not found in this company.");
      if (allocation.amountCents > bill.balanceCents) {
        throw new Error(
          `Cannot apply more than the ${bill.number} balance of $${(bill.balanceCents / 100).toFixed(2)}.`,
        );
      }
    }
  }

  const controlKey =
    input.type === "RECEIPT" ? SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE : SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE;
  const control = await getSystemAccount(tx, input.companyId, controlKey);

  const party =
    input.type === "RECEIPT"
      ? input.customerId
        ? await tx.customer.findFirst({ where: { id: input.customerId, companyId: input.companyId } })
        : null
      : input.vendorId
        ? await tx.vendor.findFirst({ where: { id: input.vendorId, companyId: input.companyId } })
        : null;

  const number = await nextNumber(tx, input.companyId, "payment");
  const label = `${input.type === "RECEIPT" ? "Receipt" : "Payment"} ${number}${party ? ` — ${party.name}` : ""}`;

  const entry = await postJournal(tx, {
    companyId: input.companyId,
    date,
    memo: input.memo ?? label,
    sourceType: "PAYMENT",
    sourceId: null,
    sourceNumber: number,
    createdById: input.userId,
    lines:
      input.type === "RECEIPT"
        ? [
            { accountId: input.bankAccountId, debitCents: input.amountCents, description: label, customerId: input.customerId },
            { accountId: control.id, creditCents: input.amountCents, description: label, customerId: input.customerId },
          ]
        : [
            { accountId: control.id, debitCents: input.amountCents, description: label, vendorId: input.vendorId },
            { accountId: input.bankAccountId, creditCents: input.amountCents, description: label, vendorId: input.vendorId },
          ],
  });

  const payment = await tx.payment.create({
    data: {
      companyId: input.companyId,
      type: input.type,
      number,
      date,
      customerId: input.customerId ?? null,
      vendorId: input.vendorId ?? null,
      bankAccountId: input.bankAccountId,
      method: input.method ?? "EFT",
      reference: input.reference,
      memo: input.memo,
      amountCents: input.amountCents,
      appliedCents: allocatedTotal,
      unappliedCents: input.amountCents - allocatedTotal,
      status: "POSTED",
      journalEntryId: entry.id,
      bankTransactionId: input.bankTransactionId ?? null,
      createdById: input.userId ?? null,
      postedAt: new Date(),
      allocations: {
        create: allocations.map((a) => ({
          invoiceId: a.invoiceId ?? null,
          billId: a.billId ?? null,
          creditNoteId: a.creditNoteId ?? null,
          amountCents: a.amountCents,
          date,
        })),
      },
    },
    include: { allocations: true },
  });

  await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: payment.id } });

  for (const allocation of payment.allocations) {
    if (allocation.invoiceId) await refreshInvoiceStatus(tx, allocation.invoiceId);
    if (allocation.billId) await refreshBillStatus(tx, allocation.billId);
  }

  return payment;
}

/** Apply an existing unapplied receipt/payment (or customer credit) later on. */
export async function applyPayment(
  companyId: string,
  paymentId: string,
  allocations: AllocationInput[],
) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, companyId },
      include: { allocations: true },
    });
    if (!payment) throw new Error("Payment not found in this company.");

    const requested = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (requested > payment.unappliedCents) {
      throw new Error(
        `Only $${(payment.unappliedCents / 100).toFixed(2)} of this payment is unapplied.`,
      );
    }

    await tx.paymentAllocation.createMany({
      data: allocations.map((a) => ({
        paymentId,
        invoiceId: a.invoiceId ?? null,
        billId: a.billId ?? null,
        creditNoteId: a.creditNoteId ?? null,
        amountCents: a.amountCents,
        date: new Date(),
      })),
    });

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        appliedCents: payment.appliedCents + requested,
        unappliedCents: payment.unappliedCents - requested,
      },
    });

    for (const a of allocations) {
      if (a.invoiceId) await refreshInvoiceStatus(tx, a.invoiceId);
      if (a.billId) await refreshBillStatus(tx, a.billId);
    }

    return tx.payment.findUnique({ where: { id: paymentId }, include: { allocations: true } });
  });
}

export async function voidPayment(companyId: string, paymentId: string, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: paymentId, companyId },
      include: { allocations: true },
    });
    if (!payment) throw new Error("Payment not found in this company.");
    if (payment.status === "VOID") throw new Error("Payment is already void.");

    const touchedInvoices = payment.allocations.map((a) => a.invoiceId).filter(Boolean) as string[];
    const touchedBills = payment.allocations.map((a) => a.billId).filter(Boolean) as string[];

    await tx.paymentAllocation.deleteMany({ where: { paymentId } });
    if (payment.journalEntryId) {
      await reverseJournal(tx, payment.journalEntryId, {
        companyId, memo: `Void payment ${payment.number}`, userId,
      });
    }
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "VOID", appliedCents: 0, unappliedCents: 0 },
    });

    for (const id of touchedInvoices) await refreshInvoiceStatus(tx, id);
    for (const id of touchedBills) await refreshBillStatus(tx, id);

    return payment;
  });
}
