/**
 * Fixed assets: register, monthly depreciation run, disposal and the continuity schedule.
 *
 * Posting rules
 *   Depreciation run   Dr Depreciation expense / Cr Accumulated depreciation, one balanced
 *                      entry per run, dated the last day of the month, summed per category.
 *   Opening entry      Dr Asset cost / Cr Accumulated depreciation / Cr Opening Balance Equity
 *                      (only when the asset's cost is not already in the ledger).
 *   Disposal           Dr Proceeds account, Dr Accumulated depreciation, Cr Asset cost,
 *                      and the difference to a gain/loss account.
 *
 * A month cannot be charged twice for the same asset: FixedAssetDepreciation is unique on
 * (assetId, periodEnd), so a rerun simply finds nothing left to do.
 */

import { db, type Tx } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { toUtcDay } from "@/lib/dates";
import { getSystemAccount, postJournal, reverseJournal } from "@/server/accounting/ledger";
import { depreciationStart, monthEnd, monthEndsBetween, monthlyCharge, nextAssetNumber, type DepreciableAsset } from "@/lib/depreciation";

export class FixedAssetError extends Error {}

// ── categories ──────────────────────────────────────────────────────────────

export interface CategoryInput {
  companyId: string;
  name: string;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId: string;
  method: "STRAIGHT_LINE" | "DECLINING_BALANCE";
  usefulLifeMonths: number;
  /** Percent, e.g. 30 for 30%. */
  decliningRatePercent: number;
  residualPercent: number;
}

async function assertAccounts(tx: Tx, input: CategoryInput) {
  const ids = [input.assetAccountId, input.accumulatedDepreciationAccountId, input.depreciationExpenseAccountId];
  const accounts = await tx.account.findMany({ where: { companyId: input.companyId, id: { in: ids }, isActive: true } });
  if (accounts.length !== new Set(ids).size) throw new FixedAssetError("Choose three active accounts from this company's chart.");
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (byId.get(input.assetAccountId)?.type !== "ASSET") throw new FixedAssetError("The asset account must be an asset account.");
  if (byId.get(input.accumulatedDepreciationAccountId)?.type !== "ASSET") throw new FixedAssetError("Accumulated depreciation must be an asset (contra) account.");
  if (byId.get(input.depreciationExpenseAccountId)?.type !== "EXPENSE") throw new FixedAssetError("The depreciation expense account must be an expense account.");
  if (input.assetAccountId === input.accumulatedDepreciationAccountId) throw new FixedAssetError("Cost and accumulated depreciation need separate accounts.");
}

export async function saveCategory(input: CategoryInput, id?: string) {
  const name = input.name.trim();
  if (!name) throw new FixedAssetError("Give the category a name.");
  if (input.method === "STRAIGHT_LINE" && !(input.usefulLifeMonths > 0)) throw new FixedAssetError("Enter the useful life in months.");
  if (input.method === "DECLINING_BALANCE" && !(input.decliningRatePercent > 0 && input.decliningRatePercent <= 100)) {
    throw new FixedAssetError("Enter an annual rate between 0 and 100%.");
  }
  if (input.residualPercent < 0 || input.residualPercent >= 100) throw new FixedAssetError("Residual value must be between 0 and 100% of cost.");

  return db.$transaction(async (tx) => {
    await assertAccounts(tx, input);
    const data = {
      name,
      assetAccountId: input.assetAccountId,
      accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId,
      depreciationExpenseAccountId: input.depreciationExpenseAccountId,
      method: input.method,
      usefulLifeMonths: Math.max(1, Math.round(input.usefulLifeMonths || 1)),
      decliningRateMicro: Math.round(input.decliningRatePercent * 10_000),
      residualPercentMicro: Math.round(input.residualPercent * 10_000),
    };
    const clash = await tx.fixedAssetCategory.findFirst({ where: { companyId: input.companyId, name, ...(id ? { NOT: { id } } : {}) } });
    if (clash) throw new FixedAssetError(`A category named "${name}" already exists.`);
    return id
      ? tx.fixedAssetCategory.update({ where: { id }, data })
      : tx.fixedAssetCategory.create({ data: { companyId: input.companyId, ...data } });
  });
}

// ── assets ──────────────────────────────────────────────────────────────────

export interface AssetInput {
  companyId: string;
  categoryId: string;
  name: string;
  description?: string | null;
  location?: string | null;
  serialNumber?: string | null;
  vendorName?: string | null;
  billId?: string | null;
  acquisitionDate: Date | string;
  inServiceDate?: Date | string | null;
  costCents: number;
  /** Overrides the category's residual percentage when set. */
  residualCents?: number | null;
  /** Migrated asset: depreciation already taken, as of `openingAsOf`. */
  openingAccumulatedCents?: number;
  openingAsOf?: Date | string | null;
  /** The cost is not in the ledger yet (migration): post Dr cost / Cr accumulated / Cr Opening Balance Equity. */
  postOpeningEntry?: boolean;
  userId?: string | null;
}

export async function createAsset(input: AssetInput) {
  if (!input.name.trim()) throw new FixedAssetError("Give the asset a name.");
  if (!Number.isInteger(input.costCents) || input.costCents <= 0) throw new FixedAssetError("Enter the asset's cost.");
  const opening = input.openingAccumulatedCents ?? 0;
  if (opening < 0 || opening > input.costCents) throw new FixedAssetError("Opening accumulated depreciation cannot exceed the cost.");
  if (opening > 0 && !input.openingAsOf) throw new FixedAssetError("Enter the date the opening accumulated depreciation is as of.");

  return db.$transaction(async (tx) => {
    const category = await tx.fixedAssetCategory.findFirst({ where: { id: input.categoryId, companyId: input.companyId, isActive: true } });
    if (!category) throw new FixedAssetError("Choose an active asset category.");

    const acquisitionDate = toUtcDay(input.acquisitionDate);
    const residualCents = input.residualCents ?? Math.round((input.costCents * category.residualPercentMicro) / 1_000_000);
    if (residualCents < 0 || residualCents >= input.costCents) throw new FixedAssetError("Residual value must be less than the cost.");

    const numbers = (await tx.fixedAsset.findMany({ where: { companyId: input.companyId }, select: { number: true } })).map((a) => a.number);
    const openingAsOf = opening > 0 && input.openingAsOf ? toUtcDay(input.openingAsOf) : null;

    const asset = await tx.fixedAsset.create({
      data: {
        companyId: input.companyId,
        categoryId: category.id,
        number: nextAssetNumber(numbers),
        name: input.name.trim(),
        description: input.description || null,
        location: input.location || null,
        serialNumber: input.serialNumber || null,
        vendorName: input.vendorName || null,
        billId: input.billId || null,
        acquisitionDate,
        inServiceDate: input.inServiceDate ? toUtcDay(input.inServiceDate) : acquisitionDate,
        costCents: input.costCents,
        residualCents,
        method: category.method,
        usefulLifeMonths: category.usefulLifeMonths,
        decliningRateMicro: category.decliningRateMicro,
        openingAccumulatedCents: opening,
        openingAsOf,
        createdById: input.userId ?? null,
      },
    });

    if (input.postOpeningEntry) {
      const obe = await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY);
      const entryDate = openingAsOf ?? acquisitionDate;
      const lines = [
        { accountId: category.assetAccountId, debitCents: input.costCents, description: `${asset.number} cost` },
        ...(opening > 0
          ? [{ accountId: category.accumulatedDepreciationAccountId, creditCents: opening, description: `${asset.number} accumulated depreciation` }]
          : []),
        { accountId: obe.id, creditCents: input.costCents - opening, description: `${asset.number} opening balance` },
      ].filter((l) => (l.debitCents ?? 0) + (l.creditCents ?? 0) > 0);
      await postJournal(tx, {
        companyId: input.companyId,
        date: entryDate,
        memo: `Opening balance — fixed asset ${asset.number} ${asset.name}`,
        sourceType: "FIXED_ASSET",
        sourceId: asset.id,
        sourceNumber: asset.number,
        createdById: input.userId,
        lines,
      });
    }
    return asset;
  });
}

// ── depreciation run ────────────────────────────────────────────────────────

export interface DepreciationPreviewItem {
  assetId: string;
  number: string;
  name: string;
  categoryId: string;
  categoryName: string;
  months: { periodEnd: Date; amountCents: number }[];
  totalCents: number;
}

/** What a run through `throughDate`'s month would charge: every un-charged month up to it, per active asset. */
export async function previewDepreciation(companyId: string, throughDate: Date | string) {
  const periodEnd = monthEnd(toUtcDay(throughDate));
  const assets = await db.fixedAsset.findMany({
    where: { companyId, status: "ACTIVE", inServiceDate: { lte: periodEnd } },
    include: { category: true, depreciations: { select: { periodEnd: true, amountCents: true } } },
    orderBy: { number: "asc" },
  });

  const items: DepreciationPreviewItem[] = [];
  for (const asset of assets) {
    const charged = new Map(asset.depreciations.map((d) => [d.periodEnd.getTime(), d.amountCents]));
    const start = depreciationStart(asset);
    const months: { periodEnd: Date; amountCents: number }[] = [];
    let accumulated = asset.openingAccumulatedCents;
    for (const end of monthEndsBetween(start, periodEnd)) {
      const existing = charged.get(end.getTime());
      if (existing !== undefined) {
        accumulated += existing;
        continue;
      }
      const amountCents = monthlyCharge(asset as DepreciableAsset, end, accumulated);
      accumulated += amountCents;
      if (amountCents > 0) months.push({ periodEnd: end, amountCents });
    }
    if (months.length === 0) continue;
    items.push({
      assetId: asset.id,
      number: asset.number,
      name: asset.name,
      categoryId: asset.categoryId,
      categoryName: asset.category.name,
      months,
      totalCents: months.reduce((s, m) => s + m.amountCents, 0),
    });
  }
  return { periodEnd, items, totalCents: items.reduce((s, i) => s + i.totalCents, 0) };
}

export async function runDepreciation(companyId: string, throughDate: Date | string, userId?: string | null) {
  const preview = await previewDepreciation(companyId, throughDate);
  if (preview.items.length === 0) throw new FixedAssetError("There is no depreciation left to post up to that month.");

  return db.$transaction(async (tx) => {
    const categories = await tx.fixedAssetCategory.findMany({
      where: { companyId, id: { in: [...new Set(preview.items.map((i) => i.categoryId))] } },
    });
    const byCategory = new Map(categories.map((c) => [c.id, c]));

    const totals = new Map<string, number>();
    for (const item of preview.items) totals.set(item.categoryId, (totals.get(item.categoryId) ?? 0) + item.totalCents);

    const lines = [...totals].flatMap(([categoryId, cents]) => {
      const category = byCategory.get(categoryId)!;
      return [
        { accountId: category.depreciationExpenseAccountId, debitCents: cents, description: `${category.name} depreciation` },
        { accountId: category.accumulatedDepreciationAccountId, creditCents: cents, description: `${category.name} accumulated depreciation` },
      ];
    });

    const entry = await postJournal(tx, {
      companyId,
      date: preview.periodEnd,
      memo: `Monthly depreciation — ${preview.periodEnd.toISOString().slice(0, 7)}`,
      sourceType: "DEPRECIATION",
      createdById: userId,
      lines,
    });

    const run = await tx.depreciationRun.create({
      data: { companyId, periodEnd: preview.periodEnd, totalCents: preview.totalCents, journalEntryId: entry.id, createdById: userId ?? null },
    });
    await tx.journalEntry.update({ where: { id: entry.id }, data: { sourceId: run.id } });

    // Unique (assetId, periodEnd): a concurrent second run fails here rather than double-charging.
    await tx.fixedAssetDepreciation.createMany({
      data: preview.items.flatMap((item) =>
        item.months.map((m) => ({ companyId, assetId: item.assetId, runId: run.id, periodEnd: m.periodEnd, amountCents: m.amountCents })),
      ),
    });
    return run;
  });
}

/** Reverse the most recent posted run (an older one would leave later charges standing on a gap). */
export async function reverseLatestRun(companyId: string, runId: string, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const run = await tx.depreciationRun.findFirst({ where: { id: runId, companyId } });
    if (!run) throw new FixedAssetError("That depreciation run does not exist.");
    if (run.status !== "POSTED") throw new FixedAssetError("That run is already reversed.");
    const latest = await tx.depreciationRun.findFirst({
      where: { companyId, status: "POSTED" },
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    });
    if (latest?.id !== run.id) throw new FixedAssetError("Only the most recent depreciation run can be reversed. Reverse the later run first.");

    if (run.journalEntryId) {
      await reverseJournal(tx, run.journalEntryId, {
        companyId,
        memo: `Reverse depreciation run ${run.periodEnd.toISOString().slice(0, 7)}`,
        userId,
      });
    }
    await tx.fixedAssetDepreciation.deleteMany({ where: { runId: run.id } });
    return tx.depreciationRun.update({ where: { id: run.id }, data: { status: "REVERSED" } });
  });
}

// ── disposal ────────────────────────────────────────────────────────────────

export async function disposeAsset(input: {
  companyId: string;
  assetId: string;
  date: Date | string;
  proceedsCents: number;
  /** Where the proceeds were received (required when proceeds > 0). */
  proceedsAccountId?: string | null;
  gainLossAccountId: string;
  userId?: string | null;
}) {
  return db.$transaction(async (tx) => {
    const asset = await tx.fixedAsset.findFirst({
      where: { id: input.assetId, companyId: input.companyId },
      include: { category: true, depreciations: true },
    });
    if (!asset) throw new FixedAssetError("That asset does not exist.");
    if (asset.status === "DISPOSED") throw new FixedAssetError(`${asset.number} is already disposed.`);
    const date = toUtcDay(input.date);
    if (date < asset.acquisitionDate) throw new FixedAssetError("The disposal date is before the acquisition date.");
    if (input.proceedsCents < 0) throw new FixedAssetError("Proceeds cannot be negative.");
    if (input.proceedsCents > 0 && !input.proceedsAccountId) throw new FixedAssetError("Choose the account the proceeds were received in.");

    const gainLossAccount = await tx.account.findFirst({ where: { id: input.gainLossAccountId, companyId: input.companyId, isActive: true } });
    if (!gainLossAccount) throw new FixedAssetError("Choose a gain/loss account.");

    const accumulated = asset.openingAccumulatedCents + asset.depreciations.reduce((s, d) => s + d.amountCents, 0);
    const gainLoss = input.proceedsCents + accumulated - asset.costCents;

    const lines = [
      ...(input.proceedsCents > 0 ? [{ accountId: input.proceedsAccountId!, debitCents: input.proceedsCents, description: `${asset.number} proceeds` }] : []),
      ...(accumulated > 0
        ? [{ accountId: asset.category.accumulatedDepreciationAccountId, debitCents: accumulated, description: `${asset.number} accumulated depreciation` }]
        : []),
      { accountId: asset.category.assetAccountId, creditCents: asset.costCents, description: `${asset.number} cost` },
      ...(gainLoss > 0 ? [{ accountId: gainLossAccount.id, creditCents: gainLoss, description: `${asset.number} gain on disposal` }] : []),
      ...(gainLoss < 0 ? [{ accountId: gainLossAccount.id, debitCents: -gainLoss, description: `${asset.number} loss on disposal` }] : []),
    ];
    const entry = await postJournal(tx, {
      companyId: input.companyId,
      date,
      memo: `Disposal of fixed asset ${asset.number} ${asset.name}`,
      sourceType: "FIXED_ASSET",
      sourceId: asset.id,
      sourceNumber: asset.number,
      createdById: input.userId,
      lines,
    });
    return tx.fixedAsset.update({
      where: { id: asset.id },
      data: { status: "DISPOSED", disposalDate: date, disposalProceedsCents: input.proceedsCents, disposalJournalEntryId: entry.id },
    });
  });
}

// ── continuity schedule ─────────────────────────────────────────────────────

export interface ScheduleRow {
  categoryId: string;
  categoryName: string;
  openingCostCents: number;
  additionsCents: number;
  disposalsCents: number;
  closingCostCents: number;
  openingAccumulatedCents: number;
  depreciationCents: number;
  disposalAccumulatedCents: number;
  closingAccumulatedCents: number;
  netBookValueCents: number;
}

/** Cost and accumulated depreciation by category for [from, to]: opening, additions, disposals, depreciation, closing, NBV. */
export async function continuitySchedule(companyId: string, from: Date, to: Date): Promise<ScheduleRow[]> {
  const [categories, assets] = await Promise.all([
    db.fixedAssetCategory.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    db.fixedAsset.findMany({ where: { companyId }, include: { depreciations: { select: { periodEnd: true, amountCents: true } } } }),
  ]);

  const rows = new Map<string, ScheduleRow>(
    categories.map((c) => [
      c.id,
      {
        categoryId: c.id, categoryName: c.name, openingCostCents: 0, additionsCents: 0, disposalsCents: 0, closingCostCents: 0,
        openingAccumulatedCents: 0, depreciationCents: 0, disposalAccumulatedCents: 0, closingAccumulatedCents: 0, netBookValueCents: 0,
      },
    ]),
  );

  const before = new Date(from.getTime() - 1);
  for (const asset of assets) {
    const row = rows.get(asset.categoryId);
    if (!row) continue;
    const accumulatedAt = (d: Date) =>
      asset.openingAccumulatedCents + asset.depreciations.filter((x) => x.periodEnd <= d).reduce((s, x) => s + x.amountCents, 0);
    const heldAt = (d: Date) => asset.acquisitionDate <= d && !(asset.disposalDate && asset.disposalDate <= d);

    if (heldAt(before)) {
      row.openingCostCents += asset.costCents;
      row.openingAccumulatedCents += accumulatedAt(before);
    }
    if (asset.acquisitionDate >= from && asset.acquisitionDate <= to) row.additionsCents += asset.costCents;
    row.depreciationCents += asset.depreciations
      .filter((x) => x.periodEnd >= from && x.periodEnd <= to)
      .reduce((s, x) => s + x.amountCents, 0);
    if (asset.disposalDate && asset.disposalDate >= from && asset.disposalDate <= to) {
      row.disposalsCents += asset.costCents;
      row.disposalAccumulatedCents += accumulatedAt(asset.disposalDate);
    }
    if (heldAt(to)) {
      row.closingCostCents += asset.costCents;
      row.closingAccumulatedCents += accumulatedAt(to);
    }
  }
  for (const row of rows.values()) row.netBookValueCents = row.closingCostCents - row.closingAccumulatedCents;
  return [...rows.values()];
}
