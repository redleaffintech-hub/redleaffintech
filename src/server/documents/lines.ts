/**
 * Shared line arithmetic for every source document (invoice, estimate, bill,
 * credit note, expense). Keeping this in one place is what makes an invoice and
 * a bill agree on how a 12.5% discount interacts with tax-inclusive pricing.
 */

import { applyDiscount, extendLine } from "@/lib/money";
import { calculateTax, type ComponentTax, type TaxCodeSpec } from "@/server/tax/engine";

export interface RawLine {
  accountId: string;
  description: string;
  quantityMilli?: number;
  unitPriceCents: number;
  discountPercentMicro?: number;
  taxCodeId?: string | null;
  itemId?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  isBillable?: boolean;
}

export interface ComputedLine extends RawLine {
  lineNo: number;
  quantityMilli: number;
  discountPercentMicro: number;
  /** Extended price before discount. */
  grossCents: number;
  discountCents: number;
  /** Tax-exclusive amount hitting the revenue/expense account. */
  netCents: number;
  taxCents: number;
  totalCents: number;
  taxComponents: ComponentTax[];
  jurisdiction: string;
}

export interface ComputedDocument {
  lines: ComputedLine[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  /** Tax rolled up per component, for the GL posting. */
  taxByComponent: ComponentTax[];
}

export function computeDocument(
  rawLines: RawLine[],
  taxCodes: Map<string, TaxCodeSpec>,
  taxInclusive: boolean,
  date: Date,
): ComputedDocument {
  const lines: ComputedLine[] = rawLines.map((raw, index) => {
    const quantityMilli = raw.quantityMilli ?? 1000;
    const discountPercentMicro = raw.discountPercentMicro ?? 0;
    const grossCents = extendLine(quantityMilli, raw.unitPriceCents);
    const discountCents = applyDiscount(grossCents, discountPercentMicro);
    const base = grossCents - discountCents;

    const code = raw.taxCodeId ? taxCodes.get(raw.taxCodeId) : null;
    const tax = calculateTax(code, base, taxInclusive, date);

    return {
      ...raw,
      lineNo: index + 1,
      quantityMilli,
      discountPercentMicro,
      grossCents,
      discountCents,
      netCents: tax.netCents,
      taxCents: tax.taxCents,
      totalCents: tax.totalCents,
      taxComponents: tax.components,
      jurisdiction: code?.jurisdiction ?? "CA",
    };
  });

  // Roll tax up per component so the journal gets one line per tax account
  // rather than one per invoice line.
  const merged = new Map<string, ComponentTax>();
  for (const line of lines) {
    for (const c of line.taxComponents) {
      const existing = merged.get(c.componentId);
      if (existing) {
        existing.taxCents += c.taxCents;
        existing.taxableCents += c.taxableCents;
      } else {
        merged.set(c.componentId, { ...c });
      }
    }
  }

  return {
    lines,
    subtotalCents: lines.reduce((s, l) => s + l.netCents, 0),
    discountCents: lines.reduce((s, l) => s + l.discountCents, 0),
    taxCents: lines.reduce((s, l) => s + l.taxCents, 0),
    totalCents: lines.reduce((s, l) => s + l.totalCents, 0),
    taxByComponent: [...merged.values()],
  };
}

/** Group net amounts by GL account so the journal has one line per account. */
export function netByAccount(lines: ComputedLine[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(line.accountId, (map.get(line.accountId) ?? 0) + line.netCents);
  }
  return map;
}

/**
 * Split a purchase document into its debit side.
 *
 * Recoverable tax (GST/HST/QST) is an asset — it goes to the ITC account.
 * Non-recoverable tax (PST/RST) is a genuine cost and must be capitalised into
 * the same expense or asset account as the line that bore it (§7), which is why
 * this cannot be done from the document-level tax rollup.
 */
export function splitPurchaseDebits(lines: ComputedLine[]) {
  const expenseByAccount = new Map<string, number>();
  const recoverableByAccount = new Map<string, number>();

  for (const line of lines) {
    let lineCost = line.netCents;
    for (const c of line.taxComponents) {
      if (c.taxCents === 0) continue;
      if (c.isRecoverable && c.recoverableAccountId) {
        recoverableByAccount.set(
          c.recoverableAccountId,
          (recoverableByAccount.get(c.recoverableAccountId) ?? 0) + c.taxCents,
        );
      } else {
        lineCost += c.taxCents;
      }
    }
    expenseByAccount.set(line.accountId, (expenseByAccount.get(line.accountId) ?? 0) + lineCost);
  }

  return { expenseByAccount, recoverableByAccount };
}
