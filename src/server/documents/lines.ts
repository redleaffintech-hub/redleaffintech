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
  /** "PERCENT" (default) or "FIXED" — see discountAmountCents. */
  discountMode?: "PERCENT" | "FIXED";
  discountPercentMicro?: number;
  /** Total discount on the extended line when discountMode is "FIXED" — not
   * multiplied by quantity again (issue 6, 15 Sep 2026 review). Ignored when
   * discountMode is "PERCENT". */
  discountAmountCents?: number;
  taxCodeId?: string | null;
  itemId?: string | null;
  customerId?: string | null;
  projectId?: string | null;
  isBillable?: boolean;
}

export interface ComputedLine extends RawLine {
  lineNo: number;
  quantityMilli: number;
  discountMode: "PERCENT" | "FIXED";
  discountPercentMicro: number;
  discountAmountCents: number;
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
  suppressedKinds?: ReadonlySet<string>,
): ComputedDocument {
  const lines: ComputedLine[] = rawLines.map((raw, index) => {
    const quantityMilli = raw.quantityMilli ?? 1000;
    const discountMode = raw.discountMode ?? "PERCENT";
    const discountPercentMicro = raw.discountPercentMicro ?? 0;
    const discountAmountCents = raw.discountAmountCents ?? 0;
    const grossCents = extendLine(quantityMilli, raw.unitPriceCents);
    const discountCents =
      discountMode === "FIXED"
        ? Math.max(0, Math.min(discountAmountCents, grossCents))
        : applyDiscount(grossCents, discountPercentMicro);
    const base = grossCents - discountCents;

    const code = raw.taxCodeId ? taxCodes.get(raw.taxCodeId) : null;
    const tax = calculateTax(code, base, taxInclusive, date, suppressedKinds);

    return {
      ...raw,
      lineNo: index + 1,
      quantityMilli,
      discountMode,
      discountPercentMicro,
      discountAmountCents,
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

/**
 * Reject an invalid line discount server-side, before computeDocument ever
 * runs (issue 6, 15 Sep 2026 review) — computeDocument itself clamps rather
 * than throws, since it also has to tolerate already-persisted rows.
 */
export function assertValidDiscount(raw: RawLine, lineLabel = "Line"): void {
  const mode = raw.discountMode ?? "PERCENT";
  if (mode === "FIXED") {
    const quantityMilli = raw.quantityMilli ?? 1000;
    const grossCents = extendLine(quantityMilli, raw.unitPriceCents);
    const amount = raw.discountAmountCents ?? 0;
    if (amount < 0 || amount > grossCents) {
      throw new Error(`${lineLabel}: fixed discount must be between $0 and the line's extended amount.`);
    }
  } else {
    const pct = raw.discountPercentMicro ?? 0;
    if (pct < 0 || pct > 100_000_000) {
      throw new Error(`${lineLabel}: discount percent must be between 0% and 100%.`);
    }
  }
}

export interface NetByAccountEntry {
  accountId: string;
  taxCodeId: string | null;
  netCents: number;
}

/**
 * Group net amounts by GL account so the journal has one line per account
 * (per account *and tax code*, so the tax centre can tell a taxed revenue
 * line from a genuinely zero-rated/exempt one on the resulting JournalLine —
 * collapsing tax codes together here is what silently untaxes every revenue
 * line downstream).
 */
export function netByAccount(lines: ComputedLine[]): NetByAccountEntry[] {
  const map = new Map<string, NetByAccountEntry>();
  for (const line of lines) {
    const taxCodeId = line.taxCodeId ?? null;
    const key = `${line.accountId}|${taxCodeId ?? ""}`;
    const existing = map.get(key);
    if (existing) existing.netCents += line.netCents;
    else map.set(key, { accountId: line.accountId, taxCodeId, netCents: line.netCents });
  }
  return [...map.values()];
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
