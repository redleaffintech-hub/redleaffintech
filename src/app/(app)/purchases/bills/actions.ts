"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability, requireCompany } from "@/server/auth/context";
import { approveBill, createBill, postBill, updateBill, voidBill } from "@/server/documents/bills-fs";
import { recordPayment } from "@/server/documents/payments-fs";
import { bills as billsRepo } from "@/server/db/bills";
import { getCompanyOrThrow } from "@/server/db/companies";
import { listVendors } from "@/server/db/vendors";
import { listAccounts } from "@/server/db/accounts";
import { listTaxCodes } from "@/server/db/tax-codes";
import { listItems } from "@/server/db/items";

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
        // Percent x 1e6, the same convention the sales side uses.
        discountPercentMicro: Math.round(line.discountPercent * 1_000_000),
        taxCodeId: line.taxCodeId,
        itemId: line.itemId,
      })),
    });
    revalidatePath("/purchases/bills");
    revalidatePath("/");
    return { redirectTo: `/purchases/bills/${bill.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function updateBillAction(billId: string, payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BILLS);
  const parsed = schema.safeParse(JSON.parse(payload));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await updateBill({
      billId,
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
        discountPercentMicro: Math.round(line.discountPercent * 1_000_000),
        taxCodeId: line.taxCodeId,
        itemId: line.itemId,
      })),
    });
    revalidatePath("/purchases/bills");
    revalidatePath(`/purchases/bills/${billId}`);
    revalidatePath("/");
    return { redirectTo: `/purchases/bills/${billId}` };
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
  const bill = await billsRepo.get(company.id, billId);
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
  const [vendorRows, allAccounts, allTaxCodes, allItems, profile] = await Promise.all([
    listVendors(company.id, { activeOnly: true }),
    listAccounts(company.id),
    listTaxCodes(company.id, { activeOnly: true }),
    listItems(company.id, { activeOnly: true }),
    getCompanyOrThrow(company.id),
  ]);
  const vendors = vendorRows
    .map((v) => ({ id: v.id, name: v.name, taxCodeId: v.taxCodeId, paymentTermsDays: v.paymentTermsDays }));
  const accounts = allAccounts
    .filter((a) => a.isActive && ["EXPENSE", "ASSET", "LIABILITY"].includes(a.type))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }));
  // The same catalogue serves purchases. A bill seeds the item's EXPENSE
  // account and purchase tax code — never the income account.
  const taxCodes = allTaxCodes
    .filter((c) => c.appliesToPurchases)
    .sort((a, b) => a.code.localeCompare(b.code));
  const items = [...allItems].sort((a, b) => a.code.localeCompare(b.code));
  return {
    vendors,
    accounts,
    taxCodes,
    items,
    company,
    profile,
    /** The plain list the new-vendor dialog offers as a default code. */
    purchaseTaxCodes: taxCodes.map((code) => ({ id: code.id, code: code.code, name: code.name })),
  };
}
