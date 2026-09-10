import "server-only";

/**
 * Canadian sales-tax engine (§7) — Firestore data access.
 *
 * The arithmetic (`calculateTax`, compounding, inclusive/exclusive, rounding)
 * is pure and unchanged — re-exported from ./engine. Only the three
 * database-touching helpers are reimplemented here:
 *
 *   loadTaxCodesTx      read the codes a document needs (+ components)
 *   findTaxPeriodForDate resolve the period a date falls in (read during planning)
 *   recordTaxEntriesTx  write the per-component audit rows (write phase; takes a
 *                       pre-resolved taxPeriodId because a Firestore transaction
 *                       cannot read after it has written)
 */

import { getTaxCodesByIdsTx } from "@/server/db/tax-codes";
import { findTaxPeriodForDate, findTaxPeriodTx } from "@/server/db/tax-periods";
import { createTaxEntriesTx } from "@/server/db/tax-entries";
import type { Tx } from "@/server/db/firestore";
import type { TaxCode } from "@/server/db/types";
import {
  assertEffective,
  calculateTax,
  TaxError,
  taxPostings,
  type ComponentTax,
  type TaxCodeSpec,
  type TaxComponentSpec,
  type TaxResult,
} from "./engine";

export {
  assertEffective,
  calculateTax,
  TaxError,
  taxPostings,
  type ComponentTax,
  type TaxCodeSpec,
  type TaxComponentSpec,
  type TaxResult,
};

/** A stored TaxCode satisfies the pure engine's TaxCodeSpec structurally. */
function asSpec(code: TaxCode): TaxCodeSpec {
  return code as unknown as TaxCodeSpec;
}

export async function loadTaxCodesTx(
  tx: Tx,
  companyId: string,
  ids: (string | null | undefined)[],
): Promise<Map<string, TaxCodeSpec>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const codes = await getTaxCodesByIdsTx(tx, companyId, unique);
  if (codes.size !== unique.length) {
    throw new TaxError("One or more tax codes do not exist in this company.");
  }
  return new Map([...codes].map(([id, code]) => [id, asSpec(code)]));
}

export { findTaxPeriodTx, findTaxPeriodForDate };

export interface TaxEntryWriteInput {
  companyId: string;
  date: Date;
  direction: "SALE" | "PURCHASE";
  sourceType: string;
  sourceId: string;
  sourceNumber?: string | null;
  lineId?: string | null;
  taxCodeId: string;
  jurisdiction: string;
  partyName?: string | null;
  journalEntryId?: string | null;
  /** Resolved during the planning phase — see module doc. */
  taxPeriodId: string | null;
  components: ComponentTax[];
  negate?: boolean;
}

export function recordTaxEntriesTx(tx: Tx, input: TaxEntryWriteInput): void {
  if (input.components.length === 0) return;
  const sign = input.negate ? -1 : 1;
  createTaxEntriesTx(
    tx,
    input.components.map((c) => ({
      companyId: input.companyId,
      date: input.date,
      direction: input.direction,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceNumber: input.sourceNumber ?? null,
      lineId: input.lineId ?? null,
      taxCodeId: input.taxCodeId,
      taxComponentId: c.componentId,
      jurisdiction: input.jurisdiction,
      kind: c.kind,
      rateMicro: c.rateMicro,
      taxableCents: c.taxableCents * sign,
      taxCents: c.taxCents * sign,
      recoverableCents:
        input.direction === "PURCHASE" && c.isRecoverable ? c.taxCents * sign : 0,
      journalEntryId: input.journalEntryId ?? null,
      taxPeriodId: input.taxPeriodId,
      partyName: input.partyName ?? null,
    })),
  );
}
