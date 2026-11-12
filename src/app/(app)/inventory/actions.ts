"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { adjustStock, reverseInventoryCost, setOpeningStock } from "@/server/inventory/costing";

export async function inventoryAdjustmentFormOptions() {
  const { company } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const accounts = await db.account.findMany({
    where: { companyId: company.id, isActive: true, type: { not: "REVENUE" } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
  return { accounts };
}

const adjustSchema = z.object({
  itemId: z.string().min(1),
  date: z.string().min(1),
  quantity: z.string().trim().min(1, "Enter a quantity."),
  unitCost: z.string().trim().optional(),
  offsetAccountId: z.string().min(1, "Choose an offset account."),
  reason: z.string().trim().min(1, "Give a reason.").max(200),
});

export async function adjustStockAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the adjustment details." };
  }
  const parsed = adjustSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the adjustment details." };
  const input = parsed.data;

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity === 0) return { error: "Enter a non-zero quantity." };
  const quantityMilli = Math.round(quantity * 1000);

  try {
    await db.$transaction((tx) =>
      adjustStock(tx, {
        companyId: company.id,
        itemId: input.itemId,
        date: input.date,
        quantityMilli,
        unitCostCents: input.unitCost ? toCents(input.unitCost) : undefined,
        offsetAccountId: input.offsetAccountId,
        reason: input.reason,
        userId: user.id,
      }),
    );

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "ServiceItem",
      entityId: input.itemId,
      summary: `Stock adjusted ${quantityMilli > 0 ? "+" : ""}${quantity} — ${input.reason}`,
    });

    revalidatePath("/inventory");
    revalidatePath("/company/products-services");
    revalidatePath("/");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function reverseInventoryCostAction(itemId: string, movementId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  try {
    await db.$transaction((tx) => reverseInventoryCost(tx, { companyId: company.id, movementId, userId: user.id }));
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "ServiceItem",
      entityId: itemId,
      summary: "Additional inventory cost reversed",
    });
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${itemId}`);
    revalidatePath("/");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const openingSchema = z.object({
  itemId: z.string().min(1),
  date: z.string().min(1, "Choose the opening date."),
  quantity: z.string().trim().min(1, "Enter the opening quantity (0 to remove it)."),
  unitCost: z.string().trim().optional(),
});

/** Create or edit an item's opening stock (quantity and unit cost on an opening date). */
export async function setOpeningStockAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the opening stock details." };
  }
  const parsed = openingSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the opening stock details." };
  const input = parsed.data;

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) return { error: "Enter a quantity of 0 or more." };

  try {
    await db.$transaction((tx) =>
      setOpeningStock(tx, {
        companyId: company.id,
        itemId: input.itemId,
        date: input.date,
        quantityMilli: Math.round(quantity * 1000),
        unitCostCents: input.unitCost ? toCents(input.unitCost) : 0,
        userId: user.id,
      }),
    );

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "ServiceItem",
      entityId: input.itemId,
      summary: `Opening stock set to ${quantity}${input.unitCost ? ` at ${input.unitCost}` : ""}`,
    });

    revalidatePath("/inventory");
    revalidatePath("/company/products-services");
    revalidatePath("/");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
