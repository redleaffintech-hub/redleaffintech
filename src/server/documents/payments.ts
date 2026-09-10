import "server-only";

/**
 * Customer receipts and vendor payments (§8, §9) — Firestore implementation.
 *
 *   Receipt (money in)          Payment (money out)
 *     Dr  Bank        amount      Dr  Accounts Payable   amount
 *       Cr  A/R         amount       Cr  Bank              amount
 *
 * Allocation stays separate from the cash posting: an unapplied receipt is a
 * real credit in the A/R control account.
 */

import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { toUtcDay } from "@/lib/dates";
import { getAccountsTx } from "@/server/db/accounts";
import { runTransaction, SEQUENCE_FIELD } from "@/server/db/companies";
import { getCustomerTx } from "@/server/db/customers";
import { getVendorTx } from "@/server/db/vendors";
import { invoices } from "@/server/db/invoices";
import { bills } from "@/server/db/bills";
import { createPaymentTx, getPaymentTx, updatePaymentTx } from "@/server/db/payments";
import {
  createAllocationsTx,
  deleteAllocationsForPaymentTx,
  listAllocationsForBill,
  listAllocationsForInvoice,
  listAllocationsForPayment,
} from "@/server/db/payment-allocations";
import { updateEntryTx } from "@/server/db/journal-entries";
import { companyRef } from "@/server/db/firestore";
import {
  commitPosting,
  getSystemAccount,
  planPosting,
  reverseJournal,
} from "@/server/accounting/ledger";
import { refreshInvoiceStatusTx } from "./invoices";
import { refreshBillStatusTx } from "./bills";

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
  bankAccountId: string;
  amountCents: number;
  method?: string;
  reference?: string;
  memo?: string;
  allocations?: AllocationInput[];
  bankTransactionId?: string | null;
  userId?: string | null;
}

/** A party's open documents, oldest due date first, for allocating a payment. */
export async function openDocumentsForParty(
  companyId: string,
  type: "RECEIPT" | "PAYMENT",
  partyId: string,
) {
  const repo = type === "RECEIPT" ? invoices : bills;
  const field = type === "RECEIPT" ? "customerId" : "vendorId";
  const rows = await repo.list(companyId, {
    where: [[field, "==", partyId]],
    orderBy: "dueDate",
  });
  return rows
    .filter((d) => d.balanceCents > 0 && d.status !== "DRAFT" && d.status !== "VOID")
    .map((d) => ({
      id: d.id,
      number: d.number,
      issueDate: d.issueDate,
      dueDate: d.dueDate,
      balanceCents: d.balanceCents,
    }));
}

export async function recordPayment(input: PaymentInput) {
  return runTransaction(async (tx) => {
    const date = toUtcDay(input.date);
    if (input.amountCents <= 0) throw new Error("Payment amount must be greater than zero.");

    const allocations = input.allocations ?? [];
    const allocatedTotal = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (allocatedTotal > input.amountCents) throw new Error("Allocations exceed the payment amount.");

    // ── Read phase ──────────────────────────────────────────────────────────
    const bankAccount = (await getAccountsTx(tx, input.companyId, [input.bankAccountId])).get(
      input.bankAccountId,
    );
    if (!bankAccount) throw new Error("Bank account not found in this company.");

    const controlKey =
      input.type === "RECEIPT"
        ? SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE
        : SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE;
    const control = await getSystemAccount(tx, input.companyId, controlKey);

    const touchedInvoices = new Map<string, { totalCents: number; existing: { amountCents: number; kind: string }[] }>();
    const touchedBills = new Map<string, { totalCents: number; existing: { amountCents: number; kind: string }[] }>();

    for (const a of allocations) {
      if (a.amountCents <= 0) throw new Error("Allocation amounts must be positive.");
      if (a.invoiceId) {
        const invoice = await invoices.getTx(tx, input.companyId, a.invoiceId);
        if (!invoice) throw new Error("Invoice not found in this company.");
        if (invoice.status === "DRAFT") throw new Error(`Invoice ${invoice.number} is not posted yet.`);
        if (a.amountCents > invoice.balanceCents) {
          throw new Error(
            `Cannot apply more than the ${invoice.number} balance of $${(invoice.balanceCents / 100).toFixed(2)}.`,
          );
        }
        const existing = await listAllocationsForInvoice(input.companyId, a.invoiceId);
        touchedInvoices.set(a.invoiceId, {
          totalCents: invoice.totalCents,
          existing: existing.map((e) => ({ amountCents: e.amountCents, kind: e.kind })),
        });
      }
      if (a.billId) {
        const bill = await bills.getTx(tx, input.companyId, a.billId);
        if (!bill) throw new Error("Bill not found in this company.");
        if (a.amountCents > bill.balanceCents) {
          throw new Error(
            `Cannot apply more than the ${bill.number} balance of $${(bill.balanceCents / 100).toFixed(2)}.`,
          );
        }
        const existing = await listAllocationsForBill(input.companyId, a.billId);
        touchedBills.set(a.billId, {
          totalCents: bill.totalCents,
          existing: existing.map((e) => ({ amountCents: e.amountCents, kind: e.kind })),
        });
      }
    }

    const party =
      input.type === "RECEIPT"
        ? input.customerId
          ? await getCustomerTx(tx, input.companyId, input.customerId)
          : null
        : input.vendorId
          ? await getVendorTx(tx, input.companyId, input.vendorId)
          : null;

    const companySnap = await tx.get(companyRef(input.companyId));
    const cdata = companySnap.data()!;
    const seq = SEQUENCE_FIELD.payment;
    const counterAt = Number(cdata[seq.next] ?? 1);
    const number = `${String(cdata[seq.prefix] ?? "")}${counterAt}`;
    const label = `${input.type === "RECEIPT" ? "Receipt" : "Payment"} ${number}${party ? ` — ${party.name}` : ""}`;

    const plan = await planPosting(tx, {
      companyId: input.companyId,
      date,
      memo: input.memo ?? label,
      sourceType: "PAYMENT",
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

    // ── Write phase ─────────────────────────────────────────────────────────
    tx.update(companyRef(input.companyId), { [seq.next]: counterAt + 1 });
    const entry = commitPosting(tx, plan);

    const payment = createPaymentTx(tx, {
      companyId: input.companyId,
      type: input.type,
      number,
      date,
      customerId: input.customerId ?? null,
      vendorId: input.vendorId ?? null,
      bankAccountId: input.bankAccountId,
      method: input.method ?? "EFT",
      reference: input.reference ?? null,
      memo: input.memo ?? null,
      amountCents: input.amountCents,
      appliedCents: allocatedTotal,
      unappliedCents: input.amountCents - allocatedTotal,
      status: "POSTED",
      journalEntryId: entry.id,
      bankTransactionId: input.bankTransactionId ?? null,
      createdById: input.userId ?? null,
      postedAt: new Date(),
    });

    createAllocationsTx(
      tx,
      allocations.map((a) => ({
        companyId: input.companyId,
        paymentId: payment.id,
        invoiceId: a.invoiceId ?? null,
        billId: a.billId ?? null,
        creditNoteId: a.creditNoteId ?? null,
        amountCents: a.amountCents,
        date,
      })),
    );

    updateEntryTx(tx, input.companyId, entry.id, { sourceId: payment.id });

    for (const a of allocations) {
      if (a.invoiceId) {
        const t = touchedInvoices.get(a.invoiceId)!;
        await refreshInvoiceStatusTx(tx, input.companyId, a.invoiceId, [
          ...t.existing,
          { amountCents: a.amountCents, kind: "PAYMENT" },
        ]);
      }
      if (a.billId) {
        const t = touchedBills.get(a.billId)!;
        await refreshBillStatusTx(tx, input.companyId, a.billId, [
          ...t.existing,
          { amountCents: a.amountCents, kind: "PAYMENT" },
        ]);
      }
    }

    return payment;
  });
}

/** Apply an existing unapplied receipt/payment against more documents later. */
export async function applyPayment(
  companyId: string,
  paymentId: string,
  allocations: AllocationInput[],
) {
  return runTransaction(async (tx) => {
    const payment = await getPaymentTx(tx, companyId, paymentId);
    if (!payment) throw new Error("Payment not found in this company.");

    const requested = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (requested > payment.unappliedCents) {
      throw new Error(`Only $${(payment.unappliedCents / 100).toFixed(2)} of this payment is unapplied.`);
    }

    // Existing allocations per touched doc, for the status recompute.
    const invoiceExisting = new Map<string, { amountCents: number; kind: string }[]>();
    const billExisting = new Map<string, { amountCents: number; kind: string }[]>();
    for (const a of allocations) {
      if (a.invoiceId && !invoiceExisting.has(a.invoiceId)) {
        invoiceExisting.set(
          a.invoiceId,
          (await listAllocationsForInvoice(companyId, a.invoiceId)).map((r) => ({
            amountCents: r.amountCents,
            kind: r.kind,
          })),
        );
      }
      if (a.billId && !billExisting.has(a.billId)) {
        billExisting.set(
          a.billId,
          (await listAllocationsForBill(companyId, a.billId)).map((r) => ({
            amountCents: r.amountCents,
            kind: r.kind,
          })),
        );
      }
    }

    const now = new Date();
    createAllocationsTx(
      tx,
      allocations.map((a) => ({
        companyId,
        paymentId,
        invoiceId: a.invoiceId ?? null,
        billId: a.billId ?? null,
        creditNoteId: a.creditNoteId ?? null,
        amountCents: a.amountCents,
        date: now,
      })),
    );
    updatePaymentTx(tx, companyId, paymentId, {
      appliedCents: payment.appliedCents + requested,
      unappliedCents: payment.unappliedCents - requested,
    });

    for (const a of allocations) {
      if (a.invoiceId) {
        await refreshInvoiceStatusTx(tx, companyId, a.invoiceId, [
          ...(invoiceExisting.get(a.invoiceId) ?? []),
          { amountCents: a.amountCents, kind: "PAYMENT" },
        ]);
      }
      if (a.billId) {
        await refreshBillStatusTx(tx, companyId, a.billId, [
          ...(billExisting.get(a.billId) ?? []),
          { amountCents: a.amountCents, kind: "PAYMENT" },
        ]);
      }
    }

    return { ...payment, appliedCents: payment.appliedCents + requested };
  });
}

export async function voidPayment(companyId: string, paymentId: string, userId?: string | null) {
  return runTransaction(async (tx) => {
    const payment = await getPaymentTx(tx, companyId, paymentId);
    if (!payment) throw new Error("Payment not found in this company.");
    if (payment.status === "VOID") throw new Error("Payment is already void.");

    const allocs = await listAllocationsForPayment(companyId, paymentId);
    const touchedInvoices = new Set(allocs.map((a) => a.invoiceId).filter(Boolean) as string[]);
    const touchedBills = new Set(allocs.map((a) => a.billId).filter(Boolean) as string[]);

    // Remaining allocations per doc after this payment's are removed.
    const invoiceRemainder = new Map<string, { amountCents: number; kind: string }[]>();
    for (const id of touchedInvoices) {
      const all = await listAllocationsForInvoice(companyId, id);
      invoiceRemainder.set(
        id,
        all.filter((a) => a.paymentId !== paymentId).map((a) => ({ amountCents: a.amountCents, kind: a.kind })),
      );
    }
    const billRemainder = new Map<string, { amountCents: number; kind: string }[]>();
    for (const id of touchedBills) {
      const all = await listAllocationsForBill(companyId, id);
      billRemainder.set(
        id,
        all.filter((a) => a.paymentId !== paymentId).map((a) => ({ amountCents: a.amountCents, kind: a.kind })),
      );
    }

    await deleteAllocationsForPaymentTx(tx, companyId, paymentId);
    if (payment.journalEntryId) {
      await reverseJournal(tx, payment.journalEntryId, {
        companyId,
        memo: `Void payment ${payment.number}`,
        userId,
      });
    }
    updatePaymentTx(tx, companyId, paymentId, {
      status: "VOID",
      appliedCents: 0,
      unappliedCents: 0,
    });

    for (const [id, remaining] of invoiceRemainder) {
      await refreshInvoiceStatusTx(tx, companyId, id, remaining);
    }
    for (const [id, remaining] of billRemainder) {
      await refreshBillStatusTx(tx, companyId, id, remaining);
    }

    return payment;
  });
}

export { listAllocationsForInvoice, listAllocationsForBill };
