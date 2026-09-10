"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability, requireCompany } from "@/server/auth/context";
import { createExpense } from "@/server/documents/expenses";
import { listAccounts } from "@/server/db/accounts";
import { listTaxCodes } from "@/server/db/tax-codes";
import { listVendors } from "@/server/db/vendors";

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
  const [accounts, allTaxCodes, vendorRows] = await Promise.all([
    listAccounts(company.id),
    listTaxCodes(company.id, { activeOnly: true }),
    listVendors(company.id, { activeOnly: true }),
  ]);
  const active = accounts.filter((a) => a.isActive).sort((a, b) => a.code.localeCompare(b.code));
  const paymentAccounts = active
    .filter((a) => ["BANK", "CASH", "CREDIT_CARD"].includes(a.subtype))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, subtype: a.subtype }));
  const expenseAccounts = active
    .filter((a) => ["EXPENSE", "ASSET"].includes(a.type))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }));
  const taxCodes = allTaxCodes
    .filter((c) => c.appliesToPurchases)
    .sort((a, b) => a.code.localeCompare(b.code));
  const vendors = vendorRows.map((v) => ({ id: v.id, name: v.name, taxCodeId: v.taxCodeId }));
  return { paymentAccounts, expenseAccounts, taxCodes, vendors };
}
