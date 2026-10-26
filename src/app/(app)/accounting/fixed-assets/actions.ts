"use server";

import { revalidatePath } from "next/cache";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { FixedAssetError, createAsset, disposeAsset, reverseLatestRun, runDepreciation, saveCategory } from "@/server/accounting/fixed-assets";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();
const num = (formData: FormData, key: string) => {
  const value = Number(text(formData, key).replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
};
const money = (formData: FormData, key: string) => {
  try {
    return toCents(text(formData, key) || "0");
  } catch {
    throw new FixedAssetError("Enter amounts as numbers.");
  }
};

function fail(error: unknown) {
  return { error: error instanceof Error ? error.message : "Something went wrong." };
}

export async function saveCategoryAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.JOURNALS);
  try {
    const id = text(formData, "id") || undefined;
    const category = await saveCategory(
      {
        companyId: company.id,
        name: text(formData, "name"),
        assetAccountId: text(formData, "assetAccountId"),
        accumulatedDepreciationAccountId: text(formData, "accumulatedDepreciationAccountId"),
        depreciationExpenseAccountId: text(formData, "depreciationExpenseAccountId"),
        method: text(formData, "method") === "DECLINING_BALANCE" ? "DECLINING_BALANCE" : "STRAIGHT_LINE",
        usefulLifeMonths: Math.round(num(formData, "usefulLifeYears") * 12) || num(formData, "usefulLifeMonths"),
        decliningRatePercent: num(formData, "decliningRatePercent"),
        residualPercent: num(formData, "residualPercent"),
      },
      id,
    );
    await recordAudit({
      companyId: company.id, userId: user.id, action: id ? "UPDATE" : "CREATE", entityType: "FixedAssetCategory",
      entityId: category.id, summary: `${id ? "Updated" : "Added"} fixed asset category ${category.name}`,
    });
    revalidatePath("/accounting/fixed-assets", "layout");
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function createAssetAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.JOURNALS);
  try {
    const opening = money(formData, "openingAccumulated");
    const residual = text(formData, "residual");
    const asset = await createAsset({
      companyId: company.id,
      categoryId: text(formData, "categoryId"),
      name: text(formData, "name"),
      description: text(formData, "description") || null,
      location: text(formData, "location") || null,
      serialNumber: text(formData, "serialNumber") || null,
      vendorName: text(formData, "vendorName") || null,
      acquisitionDate: text(formData, "acquisitionDate"),
      inServiceDate: text(formData, "inServiceDate") || null,
      costCents: money(formData, "cost"),
      residualCents: residual === "" ? null : money(formData, "residual"),
      openingAccumulatedCents: opening,
      openingAsOf: text(formData, "openingAsOf") || null,
      postOpeningEntry: formData.get("postOpeningEntry") === "on",
      userId: user.id,
    });
    await recordAudit({
      companyId: company.id, userId: user.id, action: "CREATE", entityType: "FixedAsset", entityId: asset.id,
      summary: `Added fixed asset ${asset.number} ${asset.name}`,
    });
    revalidatePath("/accounting/fixed-assets", "layout");
    return { ok: true as const, redirectTo: `/accounting/fixed-assets/${asset.id}` };
  } catch (error) {
    return fail(error);
  }
}

export async function runDepreciationAction(throughDate: string) {
  const { company, user } = await requireCapability(CAPABILITIES.JOURNALS);
  try {
    const run = await runDepreciation(company.id, throughDate, user.id);
    await recordAudit({
      companyId: company.id, userId: user.id, action: "CREATE", entityType: "DepreciationRun", entityId: run.id,
      summary: `Posted depreciation through ${run.periodEnd.toISOString().slice(0, 7)}`,
    });
    revalidatePath("/accounting", "layout");
    revalidatePath("/reports", "layout");
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function reverseRunAction(runId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.JOURNALS);
  try {
    const run = await reverseLatestRun(company.id, runId, user.id);
    await recordAudit({
      companyId: company.id, userId: user.id, action: "UPDATE", entityType: "DepreciationRun", entityId: run.id,
      summary: `Reversed depreciation run ${run.periodEnd.toISOString().slice(0, 7)}`,
    });
    revalidatePath("/accounting", "layout");
    revalidatePath("/reports", "layout");
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}

export async function disposeAssetAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.JOURNALS);
  try {
    const asset = await disposeAsset({
      companyId: company.id,
      assetId: text(formData, "assetId"),
      date: text(formData, "date"),
      proceedsCents: money(formData, "proceeds"),
      proceedsAccountId: text(formData, "proceedsAccountId") || null,
      gainLossAccountId: text(formData, "gainLossAccountId"),
      userId: user.id,
    });
    await recordAudit({
      companyId: company.id, userId: user.id, action: "UPDATE", entityType: "FixedAsset", entityId: asset.id,
      summary: `Disposed fixed asset ${asset.number}`,
    });
    revalidatePath("/accounting", "layout");
    return { ok: true as const };
  } catch (error) {
    return fail(error);
  }
}
