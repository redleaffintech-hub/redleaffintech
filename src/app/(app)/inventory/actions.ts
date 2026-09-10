"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { adjustStock } from "@/server/inventory/costing-fs";
import { listAccounts } from "@/server/db/accounts";

export async function inventoryAdjustmentFormOptions() {
  const { company } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const accounts = (await listAccounts(company.id))
    .filter((a) => a.isActive && a.type !== "REVENUE")
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }));
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
    await adjustStock({
      companyId: company.id,
      itemId: input.itemId,
      date: input.date,
      quantityMilli,
      unitCostCents: input.unitCost ? toCents(input.unitCost) : undefined,
      offsetAccountId: input.offsetAccountId,
      reason: input.reason,
      userId: user.id,
    });

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
