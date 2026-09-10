import "server-only";

/**
 * Sales quotes — the Estimate model (§8) — Firestore implementation.
 *
 * A quote posts no journal. It runs through `computeDocument` so the agreed
 * total uses the same arithmetic the resulting invoice will. Recognition happens
 * only on conversion to an invoice.
 */

import { addDays, toUtcDay } from "@/lib/dates";
import { bumpSequenceTx, runTransaction } from "@/server/db/companies";
import { getCustomerTx } from "@/server/db/customers";
import { estimates } from "@/server/db/estimates";
import type { DocumentLine, Estimate } from "@/server/db/types";
import { loadTaxCodesTx } from "@/server/tax/engine-fs";
import { createInvoice } from "./invoices-fs";
import { computeDocument, type RawLine } from "./lines";

export const DEFAULT_QUOTE_VALIDITY_DAYS = 30;

export interface EstimateInput {
  companyId: string;
  customerId: string;
  issueDate: Date | string;
  expiryDate?: Date | string;
  number?: string;
  memo?: string;
  terms?: string;
  taxInclusive?: boolean;
  lines: RawLine[];
  userId?: string | null;
}

function toDocumentLines(doc: ReturnType<typeof computeDocument>): DocumentLine[] {
  return doc.lines.map((l) => ({
    lineNo: l.lineNo,
    itemId: l.itemId ?? null,
    accountId: l.accountId,
    description: l.description,
    quantityMilli: l.quantityMilli,
    unitPriceCents: l.unitPriceCents,
    discountPercentMicro: l.discountPercentMicro,
    netCents: l.netCents,
    taxCodeId: l.taxCodeId ?? null,
    taxCents: l.taxCents,
    totalCents: l.totalCents,
  }));
}

export async function createEstimate(input: EstimateInput): Promise<Estimate> {
  return runTransaction(async (tx) => {
    const issueDate = toUtcDay(input.issueDate);
    const customer = await getCustomerTx(tx, input.companyId, input.customerId);
    if (!customer) throw new Error("Customer not found in this company.");

    const expiryDate = input.expiryDate
      ? toUtcDay(input.expiryDate)
      : addDays(issueDate, DEFAULT_QUOTE_VALIDITY_DAYS);
    if (expiryDate < issueDate) {
      throw new Error("A quote cannot expire before the day it is issued.");
    }

    const taxCodes = await loadTaxCodesTx(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
    const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);
    const number = input.number ?? (await bumpSequenceTx(tx, input.companyId, "estimate"));

    return estimates.createTx(tx, {
      companyId: input.companyId,
      customerId: input.customerId,
      number,
      issueDate,
      expiryDate,
      status: "DRAFT",
      memo: input.memo ?? null,
      terms: input.terms ?? null,
      taxInclusive: input.taxInclusive ?? false,
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      convertedInvoiceId: null,
      lines: toDocumentLines(doc),
    } as Partial<Estimate> & { companyId: string });
  });
}

const FORWARD: Record<string, string[]> = {
  DRAFT: ["SENT"],
  SENT: ["ACCEPTED", "DECLINED", "EXPIRED"],
  ACCEPTED: ["DECLINED"],
  DECLINED: ["SENT"],
  EXPIRED: ["SENT"],
};

export async function setEstimateStatus(
  companyId: string,
  estimateId: string,
  status: string,
): Promise<Estimate> {
  return runTransaction(async (tx) => {
    const estimate = await estimates.getTx(tx, companyId, estimateId);
    if (!estimate) throw new Error("Quote not found in this company.");
    if (estimate.status === "CONVERTED") {
      throw new Error(`Quote ${estimate.number} has already been converted to an invoice.`);
    }
    if (!FORWARD[estimate.status]?.includes(status)) {
      throw new Error(
        `A ${estimate.status.toLowerCase()} quote cannot move to ${status.toLowerCase()}.`,
      );
    }
    estimates.updateTx(tx, companyId, estimateId, { status });
    return { ...estimate, status };
  });
}

/**
 * Raise an invoice from an accepted quote. Two transactions: create+post the
 * invoice (invoices-fs), then mark the quote CONVERTED with a back-link.
 */
export async function convertEstimateToInvoice(
  companyId: string,
  estimateId: string,
  opts: { post?: boolean; userId?: string | null } = {},
): Promise<{ estimate: Estimate; invoiceId: string }> {
  const estimate = await estimates.get(companyId, estimateId);
  if (!estimate) throw new Error("Quote not found in this company.");
  if (estimate.status === "CONVERTED") {
    throw new Error(`Quote ${estimate.number} has already been converted.`);
  }

  const invoice = await createInvoice({
    companyId,
    customerId: estimate.customerId,
    issueDate: toUtcDay(new Date()),
    taxInclusive: estimate.taxInclusive,
    memo: estimate.memo ?? undefined,
    terms: estimate.terms ?? undefined,
    userId: opts.userId,
    post: opts.post ?? false,
    lines: estimate.lines.map((l) => ({
      accountId: l.accountId,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      discountPercentMicro: l.discountPercentMicro,
      taxCodeId: l.taxCodeId,
      itemId: l.itemId,
    })),
  });

  await estimates.update(companyId, estimateId, {
    status: "CONVERTED",
    convertedInvoiceId: invoice.id,
  });

  return { estimate: { ...estimate, status: "CONVERTED", convertedInvoiceId: invoice.id }, invoiceId: invoice.id };
}
