"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability, requireCompany } from "@/server/auth/context";
import { approveBill, createBill, postBill, voidBill } from "@/server/documents/bills";
import { recordPayment } from "@/server/documents/payments";

const schema = z.object({
  partyId: z.string().min(1),
  issueDate: z.string(),
  dueDate: z.string(),
  taxInclusive: z.boolean(),
  memo: z.string().optional(),
  reference: z.string().optional(),
  post: z.boolean(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.string(),
        discountPercent: z.number().default(0),
        accountId: z.string().min(1),
        taxCodeId: z.string().nullable(),
        itemId: z.string().nullable(),
      }),
    )
    .min(1),
});

export async function createBillAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BILLS);
  const parsed = schema.safeParse(JSON.parse(payload));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const bill = await createBill({
      companyId: company.id,
      vendorId: parsed.data.partyId,
      issueDate: parsed.data.issueDate,
      dueDate: parsed.data.dueDate,
      vendorInvoiceNo: parsed.data.reference || undefined,
      memo: parsed.data.memo || undefined,
      taxInclusive: parsed.data.taxInclusive,
      userId: user.id,
      post: parsed.data.post,
      lines: parsed.data.lines.map((line) => ({
        accountId: line.accountId,
        description: line.description,
        quantityMilli: Math.round(line.quantity * 1000),
        unitPriceCents: toCents(line.unitPrice),
        taxCodeId: line.taxCodeId,
      })),
    });
    revalidatePath("/purchases/bills");
    revalidatePath("/");
    return { redirectTo: `/purchases/bills/${bill.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function postBillAction(billId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BILLS);
  try {
    await postBill(billId, company.id, user.id);
    revalidatePath(`/purchases/bills/${billId}`);
    revalidatePath("/purchases/bills");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function approveBillAction(billId: string) {
  const { company, user, role } = await requireCompany();
  // Reviewers approve but cannot originate; §34 gives them REVIEW on bills.
  if (!["PRIMARY", "REVIEWER", "ACCOUNTANT"].includes(role)) {
    return { error: "Your role cannot approve bills." };
  }
  try {
    await approveBill(billId, company.id, user.id);
    revalidatePath(`/purchases/bills/${billId}`);
    revalidatePath("/purchases/bills");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function voidBillAction(billId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BILLS);
  try {
    await voidBill(billId, company.id, user.id);
    revalidatePath(`/purchases/bills/${billId}`);
    revalidatePath("/purchases/bills");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function payBillAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYMENTS);
  const billId = String(formData.get("billId"));
  const bill = await db.bill.findFirst({ where: { id: billId, companyId: company.id } });
  if (!bill) return { error: "Bill not found." };

  try {
    const amountCents = toCents(String(formData.get("amount") ?? "0"));
    await recordPayment({
      companyId: company.id,
      type: "PAYMENT",
      date: String(formData.get("date")),
      vendorId: bill.vendorId,
      bankAccountId: String(formData.get("bankAccountId")),
      amountCents,
      method: String(formData.get("method") ?? "EFT"),
      reference: String(formData.get("reference") ?? "") || undefined,
      memo: `Payment for ${bill.number}`,
      allocations: [{ billId: bill.id, amountCents }],
      userId: user.id,
    });
    revalidatePath(`/purchases/bills/${billId}`);
    revalidatePath("/purchases/bills");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function billFormOptions() {
  const { company } = await requireCompany();
  const [vendors, accounts, taxCodes] = await Promise.all([
    db.vendor.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, taxCodeId: true, paymentTermsDays: true },
    }),
    db.account.findMany({
      where: { companyId: company.id, isActive: true, type: { in: ["EXPENSE", "ASSET", "LIABILITY"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    db.taxCode.findMany({
      where: { companyId: company.id, isActive: true, appliesToPurchases: true },
      orderBy: { code: "asc" },
      include: { components: true },
    }),
  ]);
  return { vendors, accounts, taxCodes, company };
}
