"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability } from "@/server/auth/context";
import { applyPayment, openDocumentsForParty, recordPayment, voidPayment } from "@/server/documents/payments";
import type { OpenDocument } from "@/components/payment-form";

export async function paymentFormOptions() {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  const [vendors, bankAccounts] = await Promise.all([
    db.vendor.findMany({
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
  return { vendors, bankAccounts };
}

export async function openBillsForVendorAction(vendorId: string): Promise<OpenDocument[]> {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  const bills = await openDocumentsForParty(company.id, "PAYMENT", vendorId);
  return bills.map((b) => ({
    id: b.id,
    number: b.number,
    issueDate: b.issueDate.toISOString(),
    dueDate: b.dueDate.toISOString(),
    balanceCents: b.balanceCents,
  }));
}

const allocationSchema = z.object({ documentId: z.string().min(1), amount: z.string() });

const paymentSchema = z.object({
  partyId: z.string().min(1, "Choose a vendor."),
  date: z.string().min(1),
  bankAccountId: z.string().min(1),
  amount: z.string().min(1),
  method: z.string().min(1),
  reference: z.string().trim().max(60).optional(),
  memo: z.string().trim().max(500).optional(),
  allocations: z.array(allocationSchema).default([]),
});

export async function createPaymentAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYMENTS);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the payment details." };
  }
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the payment details." };
  const input = parsed.data;

  try {
    const payment = await recordPayment({
      companyId: company.id,
      type: "PAYMENT",
      date: input.date,
      vendorId: input.partyId,
      bankAccountId: input.bankAccountId,
      amountCents: toCents(input.amount),
      method: input.method,
      reference: input.reference,
      memo: input.memo,
      allocations: input.allocations.map((a) => ({ billId: a.documentId, amountCents: toCents(a.amount) })),
      userId: user.id,
    });
    revalidatePath("/purchases/payments");
    revalidatePath("/purchases/bills");
    revalidatePath("/");
    return { redirectTo: `/purchases/payments/${payment.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function voidPaymentAction(paymentId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYMENTS);
  try {
    await voidPayment(company.id, paymentId, user.id);
    revalidatePath(`/purchases/payments/${paymentId}`);
    revalidatePath("/purchases/payments");
    revalidatePath("/purchases/bills");
    revalidatePath("/");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const applyAllocationSchema = z.object({
  allocations: z.array(allocationSchema).min(1),
});

export async function applyPaymentAction(paymentId: string, payload: string) {
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
      parsed.data.allocations.map((a) => ({ billId: a.documentId, amountCents: toCents(a.amount) })),
    );
    revalidatePath(`/purchases/payments/${paymentId}`);
    revalidatePath("/purchases/payments");
    revalidatePath("/purchases/bills");
    revalidatePath("/");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
