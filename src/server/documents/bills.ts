/**
 * Vendor bills (spec §9, §33 Vendor Bill workflow).
 *
 * Posting rule
 *   Dr  Expense / Asset account(s)   line net + any NON-recoverable tax
 *   Dr  GST/HST Recoverable (ITC)    recoverable tax
 *     Cr  Accounts Payable             bill total
 */

import { db, type Tx } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { addDays, toUtcDay } from "@/lib/dates";
import { getSystemAccount, postJournal, reverseJournal } from "@/server/accounting/ledger";
import { loadTaxCodes, recordTaxEntries } from "@/server/tax/engine";
import { computeDocument, splitPurchaseDebits, type RawLine } from "./lines";
import { nextNumber } from "./numbering";

export interface BillInput {
  companyId: string;
  vendorId: string;
  issueDate: Date | string;
  dueDate?: Date | string;
  number?: string;
  vendorInvoiceNo?: string;
  memo?: string;
  projectId?: string | null;
  taxInclusive?: boolean;
  requiresApproval?: boolean;
  lines: RawLine[];
  userId?: string | null;
  post?: boolean;
}

export async function createBill(input: BillInput) {
  return db.$transaction(async (tx) => {
    const bill = await createBillInTx(tx, input);
    if (input.post) return postBillInTx(tx, bill.id, input.companyId, input.userId);
    return bill;
  });
}

export async function createBillInTx(tx: Tx, input: BillInput) {
  const issueDate = toUtcDay(input.issueDate);
  const vendor = await tx.vendor.findFirst({
    where: { id: input.vendorId, companyId: input.companyId },
  });
  if (!vendor) throw new Error("Vendor not found in this company.");

  // Duplicate bill detection (§9) — same vendor, same vendor invoice number.
  if (input.vendorInvoiceNo) {
    const duplicate = await tx.bill.findFirst({
      where: {
        companyId: input.companyId,
        vendorId: input.vendorId,
        vendorInvoiceNo: input.vendorInvoiceNo,
        status: { not: "VOID" },
      },
    });
    if (duplicate) {
      throw new Error(
        `${vendor.name} invoice ${input.vendorInvoiceNo} is already recorded as ${duplicate.number}.`,
      );
    }
  }

  const dueDate = input.dueDate ? toUtcDay(input.dueDate) : addDays(issueDate, vendor.paymentTermsDays);
  const taxCodes = await loadTaxCodes(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
  const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);
  const number = input.number ?? (await nextNumber(tx, input.companyId, "bill"));

  return tx.bill.create({
    data: {
      companyId: input.companyId,
      vendorId: input.vendorId,
      number,
      vendorInvoiceNo: input.vendorInvoiceNo,
      issueDate,
      dueDate,
      status: input.requiresApproval ? "AWAITING_APPROVAL" : "DRAFT",
      approvalStatus: input.requiresApproval ? "PENDING" : "NOT_REQUIRED",
      memo: input.memo,
      projectId: input.projectId ?? null,
      taxInclusive: input.taxInclusive ?? false,
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      balanceCents: doc.totalCents,
      createdById: input.userId ?? null,
      lines: {
        create: doc.lines.map((l) => ({
          lineNo: l.lineNo,
          // The catalogue item this line came from, if any. A snapshot of the
          // link, not a live lookup: the price, description and discount below
          // are what was actually charged, and editing the item later must not
          // change them.
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
          isBillable: l.isBillable ?? false,
          customerId: l.customerId ?? null,
          projectId: l.projectId ?? null,
        })),
      },
    },
    include: { lines: true, vendor: true },
  });
}

export async function approveBill(billId: string, companyId: string, userId: string) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { id: billId, companyId } });
    if (!bill) throw new Error("Bill not found in this company.");
    if (bill.approvalStatus !== "PENDING") throw new Error("This bill is not awaiting approval.");
    await tx.auditLog.create({
      data: {
        companyId, userId, action: "UPDATE", entityType: "Bill", entityId: billId,
        summary: `Approved bill ${bill.number}`,
      },
    });
    await tx.bill.update({
      where: { id: billId },
      data: { approvalStatus: "APPROVED", approvedById: userId, approvedAt: new Date(), status: "DRAFT" },
    });
    return postBillInTx(tx, billId, companyId, userId);
  });
}

export async function postBill(billId: string, companyId: string, userId?: string | null) {
  return db.$transaction((tx) => postBillInTx(tx, billId, companyId, userId));
}

export async function postBillInTx(tx: Tx, billId: string, companyId: string, userId?: string | null) {
  const bill = await tx.bill.findFirst({
    where: { id: billId, companyId },
    include: { lines: true, vendor: true },
  });
  if (!bill) throw new Error("Bill not found in this company.");
  if (bill.journalEntryId) throw new Error(`Bill ${bill.number} is already posted.`);
  if (bill.approvalStatus === "PENDING") throw new Error(`Bill ${bill.number} needs approval first.`);
  if (bill.lines.length === 0) throw new Error("A bill needs at least one line.");

  const taxCodes = await loadTaxCodes(tx, companyId, bill.lines.map((l) => l.taxCodeId));
  const doc = computeDocument(
    bill.lines.map((l) => ({
      accountId: l.accountId,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      taxCodeId: l.taxCodeId,
      customerId: l.customerId,
      projectId: l.projectId,
      isBillable: l.isBillable,
    })),
    taxCodes,
    bill.taxInclusive,
    bill.issueDate,
  );

  const ap = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE);
  const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(doc.lines);

  const entry = await postJournal(tx, {
    companyId,
    date: bill.issueDate,
    memo: `Bill ${bill.number} — ${bill.vendor.name}`,
    sourceType: "BILL",
    sourceId: bill.id,
    sourceNumber: bill.number,
    createdById: userId,
    lines: [
      ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({
        accountId,
        debitCents: cents,
        description: bill.memo ?? `Bill ${bill.number}`,
        vendorId: bill.vendorId,
        projectId: bill.projectId,
      })),
      ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
        accountId,
        debitCents: cents,
        description: `Input tax credit — ${bill.number}`,
        vendorId: bill.vendorId,
      })),
      {
        accountId: ap.id,
        creditCents: doc.totalCents,
        description: `${bill.vendor.name} — ${bill.number}`,
        vendorId: bill.vendorId,
      },
    ],
  });

  for (const line of doc.lines) {
    if (!line.taxCodeId || line.taxComponents.length === 0) continue;
    await recordTaxEntries(tx, {
      companyId,
      date: bill.issueDate,
      direction: "PURCHASE",
      sourceType: "BILL",
      sourceId: bill.id,
      sourceNumber: bill.number,
      taxCodeId: line.taxCodeId,
      jurisdiction: line.jurisdiction,
      partyName: bill.vendor.name,
      journalEntryId: entry.id,
      components: line.taxComponents,
    });
  }

  return tx.bill.update({
    where: { id: bill.id },
    data: {
      status: "OPEN",
      journalEntryId: entry.id,
      postedAt: new Date(),
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      balanceCents: doc.totalCents - bill.amountPaidCents,
    },
    include: { lines: true, vendor: true },
  });
}

export async function voidBill(billId: string, companyId: string, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { id: billId, companyId } });
    if (!bill) throw new Error("Bill not found in this company.");
    if (bill.status === "VOID") throw new Error("Bill is already void.");
    if (bill.amountPaidCents !== 0) {
      throw new Error("Unapply the payments on this bill before voiding it.");
    }
    if (bill.journalEntryId) {
      await reverseJournal(tx, bill.journalEntryId, {
        companyId, memo: `Void bill ${bill.number}`, userId,
      });
      const original = await tx.taxEntry.findMany({
        where: { companyId, sourceType: "BILL", sourceId: bill.id },
      });
      if (original.length) {
        await tx.taxEntry.createMany({
          data: original.map((t) => ({
            companyId, date: t.date, direction: t.direction,
            sourceType: "BILL", sourceId: bill.id, sourceNumber: `${bill.number} (void)`,
            taxCodeId: t.taxCodeId, taxComponentId: t.taxComponentId,
            jurisdiction: t.jurisdiction, kind: t.kind, rateMicro: t.rateMicro,
            taxableCents: -t.taxableCents, taxCents: -t.taxCents,
            recoverableCents: -t.recoverableCents, taxPeriodId: t.taxPeriodId, partyName: t.partyName,
          })),
        });
      }
    }
    return tx.bill.update({
      where: { id: bill.id },
      data: { status: "VOID", voidedAt: new Date(), balanceCents: 0 },
    });
  });
}

export async function refreshBillStatus(tx: Tx, billId: string) {
  const bill = await tx.bill.findUnique({ where: { id: billId }, include: { allocations: true } });
  if (!bill || bill.status === "VOID" || bill.status === "DRAFT") return bill;

  const settled = bill.allocations.reduce((s, a) => s + a.amountCents, 0);
  const paid = bill.allocations.filter((a) => a.kind === "PAYMENT").reduce((s, a) => s + a.amountCents, 0);
  const balance = bill.totalCents - settled;

  let status = bill.status;
  if (balance <= 0) status = "PAID";
  else if (settled > 0) status = "PARTIALLY_PAID";
  else status = new Date() > bill.dueDate ? "OVERDUE" : "OPEN";

  return tx.bill.update({
    where: { id: billId },
    data: { amountPaidCents: paid, balanceCents: balance, status },
  });
}
