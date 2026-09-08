"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability, requireCompany } from "@/server/auth/context";
import { createExpense } from "@/server/documents/expenses";

const schema = z.object({
  date: z.string(),
  paymentAccountId: z.string().min(1),
  vendorId: z.string().optional(),
  payeeName: z.string().optional(),
  paymentMethod: z.string().optional(),
  reference: z.string().optional(),
  memo: z.string().optional(),
  accountId: z.string().min(1),
  taxCodeId: z.string().optional(),
  amount: z.string(),
});

export async function createExpenseAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.EXPENSES);
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const expense = await createExpense({
      companyId: company.id,
      date: parsed.data.date,
      paymentAccountId: parsed.data.paymentAccountId,
      vendorId: parsed.data.vendorId || null,
      payeeName: parsed.data.payeeName || undefined,
      paymentMethod: parsed.data.paymentMethod,
      reference: parsed.data.reference,
      memo: parsed.data.memo,
      // Receipts are quoted with tax included, which is how people read them.
      taxInclusive: true,
      userId: user.id,
      lines: [
        {
          accountId: parsed.data.accountId,
          description: parsed.data.memo || parsed.data.payeeName || "Expense",
          unitPriceCents: toCents(parsed.data.amount),
          taxCodeId: parsed.data.taxCodeId || null,
        },
      ],
    });
    revalidatePath("/expenses");
    revalidatePath("/");
    return { redirectTo: `/accounting/journals/${expense.journalEntryId}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function expenseFormOptions() {
  const { company } = await requireCompany();
  const [paymentAccounts, expenseAccounts, taxCodes, vendors] = await Promise.all([
    db.account.findMany({
      where: { companyId: company.id, isActive: true, subtype: { in: ["BANK", "CASH", "CREDIT_CARD"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, subtype: true },
    }),
    db.account.findMany({
      where: { companyId: company.id, isActive: true, type: { in: ["EXPENSE", "ASSET"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    db.taxCode.findMany({
      where: { companyId: company.id, isActive: true, appliesToPurchases: true },
      orderBy: { code: "asc" },
      include: { components: true },
    }),
    db.vendor.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, taxCodeId: true },
    }),
  ]);
  return { paymentAccounts, expenseAccounts, taxCodes, vendors };
}
