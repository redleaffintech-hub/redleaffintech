import "server-only";

/**
 * Tax reporting (§7, §12) — Firestore implementation.
 *
 * Tax Summary / Tax Detail read `taxEntries`; the reconciliation block compares
 * that subledger to the GL tax control accounts (§35 acceptance criterion).
 */

import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { recordAudit } from "@/server/db/audit-logs";
import { getAccountsBySystemKeys } from "@/server/db/accounts";
import {
  listTaxEntriesInRange,
} from "@/server/db/tax-entries";
import { getTaxCodesByIds } from "@/server/db/tax-codes";
import { getTaxPeriod, updateTaxPeriod } from "@/server/db/tax-periods";
import type { DateRange } from "./financials";
import { sumsInRange } from "./ledger";
import type { TaxEntry } from "@/server/db/types";

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

async function withCodeNames(companyId: string, entries: TaxEntry[]) {
  const codes = await getTaxCodesByIds(companyId, [...new Set(entries.map((e) => e.taxCodeId))]);
  return (id: string) => {
    const c = codes.get(id);
    return { code: c?.code ?? "—", name: c?.name ?? "—" };
  };
}

export async function taxSummary(companyId: string, range: DateRange) {
  const entries = await listTaxEntriesInRange(companyId, range.from, range.to);
  const nameOf = await withCodeNames(companyId, entries);

  const byKey = new Map<string, TaxLineSummary>();
  for (const entry of entries) {
    const key = `${entry.kind}|${entry.jurisdiction}|${entry.taxCodeId}`;
    let row = byKey.get(key);
    if (!row) {
      const c = nameOf(entry.taxCodeId);
      row = {
        kind: entry.kind,
        jurisdiction: entry.jurisdiction,
        taxCode: c.code,
        taxCodeName: c.name,
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
  let entries = await listTaxEntriesInRange(companyId, range.from, range.to, {
    direction: filters.direction,
  });
  if (filters.taxCodeId) entries = entries.filter((e) => e.taxCodeId === filters.taxCodeId);
  if (filters.kind) entries = entries.filter((e) => e.kind === filters.kind);
  entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime());

  const nameOf = await withCodeNames(companyId, entries);
  return entries.slice(0, 2000).map((e) => ({ ...e, taxCode: nameOf(e.taxCodeId) }));
}

export async function taxControlReconciliation(companyId: string, range: DateRange) {
  const keys = [
    SYSTEM_ACCOUNTS.GST_HST_PAYABLE,
    SYSTEM_ACCOUNTS.PST_PAYABLE,
    SYSTEM_ACCOUNTS.QST_PAYABLE,
    SYSTEM_ACCOUNTS.GST_HST_RECOVERABLE,
    SYSTEM_ACCOUNTS.QST_RECOVERABLE,
  ];
  const accounts = await getAccountsBySystemKeys(companyId, keys);
  const movements = await sumsInRange(companyId, range.from, range.to);

  const entries = await listTaxEntriesInRange(companyId, range.from, range.to);
  const subledgerCollected = entries
    .filter((e) => e.direction === "SALE")
    .reduce((s, e) => s + e.taxCents, 0);
  const subledgerRecoverable = entries
    .filter((e) => e.direction === "PURCHASE")
    .reduce((s, e) => s + e.recoverableCents, 0);

  const payableAccounts = accounts.filter((a) => a.type === "LIABILITY");
  const recoverableAccounts = accounts.filter((a) => a.type === "ASSET");

  const glCollected = payableAccounts.reduce((s, a) => {
    const m = movements.get(a.id);
    return s + ((m?.creditCents ?? 0) - (m?.debitCents ?? 0));
  }, 0);
  const glRecoverable = recoverableAccounts.reduce((s, a) => {
    const m = movements.get(a.id);
    return s + ((m?.debitCents ?? 0) - (m?.creditCents ?? 0));
  }, 0);

  return {
    accounts: accounts.map((a) => {
      const m = movements.get(a.id);
      return {
        id: a.id,
        code: a.code,
        name: a.name,
        systemKey: a.systemKey,
        type: a.type,
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
    reconciled:
      subledgerCollected === glCollected && subledgerRecoverable === glRecoverable,
  };
}

export async function taxPeriodReturn(companyId: string, taxPeriodId: string) {
  const period = await getTaxPeriod(companyId, taxPeriodId);
  if (!period) throw new Error("Tax period not found in this company.");
  const range = { from: period.startDate, to: period.endDate };
  const summary = await taxSummary(companyId, range);

  const entries = await listTaxEntriesInRange(companyId, range.from, range.to, { direction: "SALE" });
  const collectedCents = entries.reduce((s, e) => s + e.taxCents, 0);

  // Line 101 straight from the REVENUE accounts (net credits) — the only figure
  // that cannot double-count a supply that carries two tax components.
  const movements = await sumsInRange(companyId, range.from, range.to);
  let line101 = 0;
  for (const m of movements.values()) {
    if (m.accountType === "REVENUE") line101 += m.creditCents - m.debitCents;
  }

  return {
    period,
    summary,
    line101SuppliesCents: line101,
    line105CollectedCents: collectedCents,
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
  const period = await getTaxPeriod(companyId, taxPeriodId);
  if (!period) throw new Error("Tax period not found in this company.");

  const result = await taxPeriodReturn(companyId, taxPeriodId);
  await recordAudit({
    companyId,
    userId,
    action: "UPDATE",
    entityType: "TaxPeriod",
    entityId: taxPeriodId,
    summary: `Tax period ${period.name} marked ${status}`,
    metadata: { net: result.line109NetCents, filingReference },
  });

  await updateTaxPeriod(companyId, taxPeriodId, {
    status,
    filingReference: filingReference ?? period.filingReference,
    filedAt: status === "FILED" ? new Date() : period.filedAt,
    lockedAt: status === "CLOSED" ? new Date() : period.lockedAt,
    netFiledCents: status === "FILED" ? result.line109NetCents : period.netFiledCents,
  });
  return { ...period, status };
}
