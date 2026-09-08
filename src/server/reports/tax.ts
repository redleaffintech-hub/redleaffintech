/**
 * Tax reporting (spec §7, §12).
 *
 * Tax Summary and Tax Detail both read `tax_entries`, and the reconciliation
 * block compares that subledger to the GL tax control accounts — the §35
 * acceptance criterion "tax reports reconcile to configured tax-control
 * accounts". A non-zero difference means someone posted tax by manual journal
 * without a matching tax entry, and the UI says so.
 */

import { db } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import type { DateRange } from "./financials";

export interface TaxLineSummary {
  kind: string;
  jurisdiction: string;
  taxCode: string;
  taxCodeName: string;
  salesTaxableCents: number;
  taxCollectedCents: number;
  purchaseTaxableCents: number;
  taxPaidCents: number;
  recoverableCents: number;
  netCents: number;
}

export async function taxSummary(companyId: string, range: DateRange) {
  const entries = await db.taxEntry.findMany({
    where: { companyId, date: { gte: range.from, lte: range.to } },
    include: { taxCode: { select: { code: true, name: true } } },
  });

  const byKey = new Map<string, TaxLineSummary>();
  for (const entry of entries) {
    const key = `${entry.kind}|${entry.jurisdiction}|${entry.taxCodeId}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        kind: entry.kind,
        jurisdiction: entry.jurisdiction,
        taxCode: entry.taxCode.code,
        taxCodeName: entry.taxCode.name,
        salesTaxableCents: 0,
        taxCollectedCents: 0,
        purchaseTaxableCents: 0,
        taxPaidCents: 0,
        recoverableCents: 0,
        netCents: 0,
      };
      byKey.set(key, row);
    }
    if (entry.direction === "SALE") {
      row.salesTaxableCents += entry.taxableCents;
      row.taxCollectedCents += entry.taxCents;
    } else {
      row.purchaseTaxableCents += entry.taxableCents;
      row.taxPaidCents += entry.taxCents;
      row.recoverableCents += entry.recoverableCents;
    }
    row.netCents = row.taxCollectedCents - row.recoverableCents;
  }

  const rows = [...byKey.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.taxCode.localeCompare(b.taxCode),
  );

  const totals = {
    salesTaxableCents: rows.reduce((s, r) => s + r.salesTaxableCents, 0),
    taxCollectedCents: rows.reduce((s, r) => s + r.taxCollectedCents, 0),
    purchaseTaxableCents: rows.reduce((s, r) => s + r.purchaseTaxableCents, 0),
    taxPaidCents: rows.reduce((s, r) => s + r.taxPaidCents, 0),
    recoverableCents: rows.reduce((s, r) => s + r.recoverableCents, 0),
    netCents: rows.reduce((s, r) => s + r.netCents, 0),
  };

  const reconciliation = await taxControlReconciliation(companyId, range);
  return { range, rows, totals, reconciliation };
}

export async function taxDetail(
  companyId: string,
  range: DateRange,
  filters: { direction?: "SALE" | "PURCHASE"; taxCodeId?: string; kind?: string } = {},
) {
  return db.taxEntry.findMany({
    where: {
      companyId,
      date: { gte: range.from, lte: range.to },
      ...(filters.direction ? { direction: filters.direction } : {}),
      ...(filters.taxCodeId ? { taxCodeId: filters.taxCodeId } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
    },
    include: {
      taxCode: { select: { code: true, name: true } },
      journalEntry: { select: { entryNo: true } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: 2000,
  });
}

/**
 * Tax subledger vs GL control accounts. Sales tax collected should equal the
 * credit movement on the payable accounts; ITCs should equal the debit movement
 * on the recoverable accounts.
 */
export async function taxControlReconciliation(companyId: string, range: DateRange) {
  const keys = [
    SYSTEM_ACCOUNTS.GST_HST_PAYABLE,
    SYSTEM_ACCOUNTS.PST_PAYABLE,
    SYSTEM_ACCOUNTS.QST_PAYABLE,
    SYSTEM_ACCOUNTS.GST_HST_RECOVERABLE,
    SYSTEM_ACCOUNTS.QST_RECOVERABLE,
  ];
  const accounts = await db.account.findMany({
    where: { companyId, systemKey: { in: keys } },
    select: { id: true, code: true, name: true, systemKey: true, type: true },
  });

  const movements = await db.journalLine.groupBy({
    by: ["accountId"],
    where: {
      companyId,
      accountId: { in: accounts.map((a) => a.id) },
      date: { gte: range.from, lte: range.to },
    },
    _sum: { debitCents: true, creditCents: true },
  });
  const byId = new Map(movements.map((m) => [m.accountId, m._sum]));

  const entries = await db.taxEntry.aggregate({
    where: { companyId, date: { gte: range.from, lte: range.to }, direction: "SALE" },
    _sum: { taxCents: true },
  });
  const recoverable = await db.taxEntry.aggregate({
    where: { companyId, date: { gte: range.from, lte: range.to }, direction: "PURCHASE" },
    _sum: { recoverableCents: true },
  });

  const payableAccounts = accounts.filter((a) => a.type === "LIABILITY");
  const recoverableAccounts = accounts.filter((a) => a.type === "ASSET");

  const glCollected = payableAccounts.reduce((s, a) => {
    const m = byId.get(a.id);
    return s + ((m?.creditCents ?? 0) - (m?.debitCents ?? 0));
  }, 0);
  const glRecoverable = recoverableAccounts.reduce((s, a) => {
    const m = byId.get(a.id);
    return s + ((m?.debitCents ?? 0) - (m?.creditCents ?? 0));
  }, 0);

  const subledgerCollected = entries._sum.taxCents ?? 0;
  const subledgerRecoverable = recoverable._sum.recoverableCents ?? 0;

  return {
    accounts: accounts.map((a) => {
      const m = byId.get(a.id);
      return {
        ...a,
        movementCents:
          a.type === "LIABILITY"
            ? (m?.creditCents ?? 0) - (m?.debitCents ?? 0)
            : (m?.debitCents ?? 0) - (m?.creditCents ?? 0),
      };
    }),
    subledgerCollected,
    glCollected,
    collectedDifferenceCents: subledgerCollected - glCollected,
    subledgerRecoverable,
    glRecoverable,
    recoverableDifferenceCents: subledgerRecoverable - glRecoverable,
    reconciled: subledgerCollected === glCollected && subledgerRecoverable === glRecoverable,
  };
}

/** The GST/HST return working figures for a filing period. */
export async function taxPeriodReturn(companyId: string, taxPeriodId: string) {
  const period = await db.taxPeriod.findFirst({ where: { id: taxPeriodId, companyId } });
  if (!period) throw new Error("Tax period not found in this company.");

  const range = { from: period.startDate, to: period.endDate };
  const summary = await taxSummary(companyId, range);

  const sales = await db.taxEntry.aggregate({
    where: { companyId, date: { gte: range.from, lte: range.to }, direction: "SALE" },
    _sum: { taxCents: true },
  });

  // Line 101 is total sales and other revenue for the period: every credit to a
  // REVENUE account, net of debits (sales returns, year-end close). Taxable,
  // zero-rated and exempt supplies are all revenue, so all are captured with no
  // tax-code bookkeeping. Deriving it straight from the revenue accounts is the
  // only figure that cannot double-count a supply — summing `tax_entries`
  // instead counts a sale once per tax component (a GST + PST code books two
  // rows), and the previous hybrid also assumed every posted revenue line
  // carried its tax code, which postings made before 2026-08-25 do not, so an
  // untaxed-revenue fallback query matched them and added each taxed sale twice.
  const revenue = await db.journalLine.aggregate({
    where: {
      companyId,
      date: { gte: range.from, lte: range.to },
      accountType: "REVENUE",
    },
    _sum: { creditCents: true, debitCents: true },
  });

  return {
    period,
    summary,
    line101SuppliesCents:
      (revenue._sum.creditCents ?? 0) - (revenue._sum.debitCents ?? 0),
    line105CollectedCents: sales._sum.taxCents ?? 0,
    line108ItcCents: summary.totals.recoverableCents,
    line109NetCents: summary.totals.netCents,
  };
}

export async function setTaxPeriodStatus(
  companyId: string,
  taxPeriodId: string,
  status: string,
  userId: string,
  filingReference?: string,
) {
  const period = await db.taxPeriod.findFirst({ where: { id: taxPeriodId, companyId } });
  if (!period) throw new Error("Tax period not found in this company.");

  const result = await taxPeriodReturn(companyId, taxPeriodId);
  await db.auditLog.create({
    data: {
      companyId, userId, action: "UPDATE", entityType: "TaxPeriod", entityId: taxPeriodId,
      summary: `Tax period ${period.name} marked ${status}`,
      metadata: JSON.stringify({ net: result.line109NetCents, filingReference }),
    },
  });

  return db.taxPeriod.update({
    where: { id: taxPeriodId },
    data: {
      status,
      filingReference,
      filedAt: status === "FILED" ? new Date() : period.filedAt,
      lockedAt: status === "CLOSED" ? new Date() : period.lockedAt,
      netFiledCents: status === "FILED" ? result.line109NetCents : period.netFiledCents,
    },
  });
}
