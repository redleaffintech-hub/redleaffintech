"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability } from "@/server/auth/context";
import { applyPayment, openDocumentsForParty, recordPayment, voidPayment } from "@/server/documents/payments";
import type { OpenDocument } from "@/components/payment-form";

export async function receiptFormOptions() {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  const [customers, bankAccounts] = await Promise.all([
    db.customer.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.account.findMany({
      where: { companyId: company.id, subtype: { in: ["BANK", "CASH"] }, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { customers, bankAccounts };
}

export async function openInvoicesForCustomerAction(customerId: string): Promise<OpenDocument[]> {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  const invoices = await openDocumentsForParty(company.id, "RECEIPT", customerId);
  return invoices.map((i) => ({
    id: i.id,
    number: i.number,
    issueDate: i.issueDate.toISOString(),
    dueDate: i.dueDate.toISOString(),
    balanceCents: i.balanceCents,
  }));
}

const allocationSchema = z.object({ documentId: z.string().min(1), amount: z.string() });

const receiptSchema = z.object({
  partyId: z.string().min(1, "Choose a customer."),
  date: z.string().min(1),
  bankAccountId: z.string().min(1),
  amount: z.string().min(1),
  method: z.string().min(1),
  reference: z.string().trim().max(60).optional(),
  memo: z.string().trim().max(500).optional(),
  allocations: z.array(allocationSchema).default([]),
});

export async function createReceiptAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYMENTS);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the receipt details." };
  }
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the receipt details." };
  const input = parsed.data;

  try {
    const payment = await recordPayment({
      companyId: company.id,
      type: "RECEIPT",
      date: input.date,
      customerId: input.partyId,
      bankAccountId: input.bankAccountId,
      amountCents: toCents(input.amount),
      method: input.method,
      reference: input.reference,
      memo: input.memo,
      allocations: input.allocations.map((a) => ({ invoiceId: a.documentId, amountCents: toCents(a.amount) })),
      userId: user.id,
    });
    revalidatePath("/sales/receipts");
    revalidatePath("/sales/invoices");
    revalidatePath("/");
    return { redirectTo: `/sales/receipts/${payment.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function voidReceiptAction(paymentId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYMENTS);
  try {
    await voidPayment(company.id, paymentId, user.id);
    revalidatePath(`/sales/receipts/${paymentId}`);
    revalidatePath("/sales/receipts");
    revalidatePath("/sales/invoices");
    revalidatePath("/");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const applyAllocationSchema = z.object({
  allocations: z.array(allocationSchema).min(1),
});

export async function applyReceiptAction(paymentId: string, payload: string) {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the allocation details." };
  }
  const parsed = applyAllocationSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the allocation details." };

  try {
    await applyPayment(
      company.id,
      paymentId,
      parsed.data.allocations.map((a) => ({ invoiceId: a.documentId, amountCents: toCents(a.amount) })),
    );
    revalidatePath(`/sales/receipts/${paymentId}`);
    revalidatePath("/sales/receipts");
    revalidatePath("/sales/invoices");
    revalidatePath("/");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
