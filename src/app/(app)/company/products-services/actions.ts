"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ITEM_TYPES } from "@/lib/enums";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";

/**
 * Products & services catalogue.
 *
 * Everything an item carries is a DEFAULT for a document line. Nothing here
 * reaches into a document that has already been written: a saved line keeps the
 * price, discount, account and tax code it was created with, and editing the
 * catalogue changes only what the NEXT selection will seed. That is what makes
 * a historical invoice reproducible.
 *
 * Management is gated on COMPANY_SETTINGS. Selecting an item while writing an
 * invoice is not — that flows through the document option loaders, which are
 * gated on the sales/purchase capabilities instead.
 */

const PERCENT_MICRO = 1_000_000;

const itemSchema = z.object({
  type: z.enum(ITEM_TYPES),
  code: z.string().trim().min(1, "Give the item a code.").max(40),
  name: z.string().trim().min(1, "Give the item a name.").max(120),
  description: z.string().trim().max(500).optional(),
  unit: z.string().trim().min(1).max(30),
  /** Typed as text so "1,250.00" parses the same way it does on a document. */
  unitPrice: z.string().trim().max(20).optional(),
  discountPercent: z.string().trim().max(10).optional(),
  incomeAccountId: z.string().trim().optional(),
  expenseAccountId: z.string().trim().optional(),
  taxCodeId: z.string().trim().optional(),
  purchaseTaxCodeId: z.string().trim().optional(),
  isActive: z.string().optional(),
});

type ItemInput = z.infer<typeof itemSchema>;

/** Shared validation that needs the database: code uniqueness and FK ownership. */
async function validate(
  companyId: string,
  input: ItemInput,
  existingId?: string,
): Promise<{ error: string } | { data: Record<string, unknown> }> {
  const code = input.code.toUpperCase();

  const clash = await db.serviceItem.findFirst({
    where: { companyId, code, ...(existingId ? { NOT: { id: existingId } } : {}) },
    select: { id: true, name: true },
  });
  if (clash) return { error: `Code ${code} is already used by "${clash.name}".` };

  let unitPriceCents = 0;
  try {
    unitPriceCents = toCents(input.unitPrice ?? "0");
  } catch {
    return { error: "Enter the list price as a number." };
  }
  if (unitPriceCents < 0) return { error: "The list price cannot be negative." };

  const discount = Number(input.discountPercent || "0");
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return { error: "The default discount must be between 0 and 100 percent." };
  }
  // Percent x 1e6, matching the document line convention. Rounded rather than
  // truncated so 33.333333% does not drift downward on every save.
  const discountPercentMicro = Math.round(discount * PERCENT_MICRO);

  // Every referenced row must belong to this company. The ids come from a form,
  // so they are not trusted just because they are well-formed.
  const [income, expense, salesTax, purchaseTax] = await Promise.all([
    input.incomeAccountId
      ? db.account.findFirst({ where: { id: input.incomeAccountId, companyId }, select: { id: true, type: true } })
      : null,
    input.expenseAccountId
      ? db.account.findFirst({ where: { id: input.expenseAccountId, companyId }, select: { id: true, type: true } })
      : null,
    input.taxCodeId ? db.taxCode.findFirst({ where: { id: input.taxCodeId, companyId }, select: { id: true } }) : null,
    input.purchaseTaxCodeId
      ? db.taxCode.findFirst({ where: { id: input.purchaseTaxCodeId, companyId }, select: { id: true } })
      : null,
  ]);

  if (input.incomeAccountId && !income) return { error: "That income account is not in this company's chart." };
  if (input.expenseAccountId && !expense) return { error: "That purchase account is not in this company's chart." };
  if (input.taxCodeId && !salesTax) return { error: "That sales tax code is not in this company's tax setup." };
  if (input.purchaseTaxCodeId && !purchaseTax) {
    return { error: "That purchase tax code is not in this company's tax setup." };
  }
  // A sales line posts to revenue and a purchase line to expense. Letting an
  // item seed the wrong side would put a cost into income on every document
  // that used it.
  if (income && income.type !== "REVENUE") return { error: "The income account must be a revenue account." };
  if (expense && !["EXPENSE", "ASSET"].includes(expense.type)) {
    return { error: "The purchase account must be an expense or asset account." };
  }

  return {
    data: {
      type: input.type,
      code,
      name: input.name,
      description: input.description || null,
      unit: input.unit,
      unitPriceCents,
      discountPercentMicro,
      incomeAccountId: input.incomeAccountId || null,
      expenseAccountId: input.expenseAccountId || null,
      taxCodeId: input.taxCodeId || null,
      purchaseTaxCodeId: input.purchaseTaxCodeId || null,
      isActive: input.isActive === "on",
    },
  };
}

export async function createItemAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the item details and try again." };
  }

  const result = await validate(company.id, parsed.data);
  if ("error" in result) return result;

  const item = await db.serviceItem.create({
    data: { companyId: company.id, ...result.data } as never,
    select: { id: true, code: true, name: true, type: true },
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "CREATE",
    entityType: "ServiceItem",
    entityId: item.id,
    summary: `${item.type === "PRODUCT" ? "Product" : "Service"} ${item.code} — ${item.name} added to the catalogue`,
  });

  revalidatePath("/company/products-services");
  return { ok: true, id: item.id };
}

export async function updateItemAction(itemId: string, formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const existing = await db.serviceItem.findFirst({
    where: { id: itemId, companyId: company.id },
    select: { id: true, code: true, name: true },
  });
  if (!existing) return { error: "That catalogue item does not belong to this company." };

  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the item details and try again." };
  }

  const result = await validate(company.id, parsed.data, itemId);
  if ("error" in result) return result;

  await db.serviceItem.update({ where: { id: itemId }, data: result.data as never });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "ServiceItem",
    entityId: itemId,
    // Documents already written are untouched — worth saying in the log, since
    // the obvious worry on reading "price updated" is whether it restated history.
    summary: `Catalogue item ${existing.code} — ${existing.name} updated (defaults only; existing documents unchanged)`,
  });

  revalidatePath("/company/products-services");
  return { ok: true };
}

export async function setItemActiveAction(itemId: string, isActive: boolean) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const item = await db.serviceItem.findFirst({
    where: { id: itemId, companyId: company.id },
    select: { id: true, code: true, name: true },
  });
  if (!item) return { error: "That catalogue item does not belong to this company." };

  await db.serviceItem.update({ where: { id: itemId }, data: { isActive } });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "ServiceItem",
    entityId: itemId,
    summary: `Catalogue item ${item.code} — ${item.name} ${isActive ? "reactivated" : "archived"}`,
  });

  revalidatePath("/company/products-services");
  return { ok: true };
}

/**
 * How many documents reference an item. Zero means it can be deleted outright.
 *
 * Deliberately NOT exported: every export of a "use server" module is a
 * client-callable endpoint, and this one takes a companyId. Exported, it would
 * let a caller probe another tenant's catalogue. The page computes its own
 * counts server-side instead.
 */
async function itemUsageCount(companyId: string, itemId: string): Promise<number> {
  const [invoices, estimates, credits, bills] = await Promise.all([
    db.invoiceLine.count({ where: { itemId, invoice: { companyId } } }),
    db.estimateLine.count({ where: { itemId, estimate: { companyId } } }),
    db.creditNoteLine.count({ where: { itemId, creditNote: { companyId } } }),
    db.billLine.count({ where: { itemId, bill: { companyId } } }),
  ]);
  return invoices + estimates + credits + bills;
}

/**
 * Permanent delete, allowed only for an item nothing has ever referenced.
 *
 * Once a document points at an item, deleting it would either break the
 * reference or silently null it out and lose the audit trail of what was sold.
 * A used item is archived instead, which hides it from new documents while
 * leaving every historical line intact and readable.
 */
export async function deleteItemAction(itemId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const item = await db.serviceItem.findFirst({
    where: { id: itemId, companyId: company.id },
    select: { id: true, code: true, name: true },
  });
  if (!item) return { error: "That catalogue item does not belong to this company." };

  const used = await itemUsageCount(company.id, itemId);
  if (used > 0) {
    return {
      error: `${item.code} appears on ${used} document${used === 1 ? "" : "s"} and cannot be deleted. Archive it instead — it will disappear from new documents and stay readable on the old ones.`,
    };
  }

  await db.serviceItem.delete({ where: { id: itemId } });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "DELETE",
    entityType: "ServiceItem",
    entityId: itemId,
    summary: `Catalogue item ${item.code} — ${item.name} deleted (never used on a document)`,
  });

  revalidatePath("/company/products-services");
  return { ok: true };
}
