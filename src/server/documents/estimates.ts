/**
 * Sales quotes — the Estimate model (spec §8).
 *
 * A quote is deliberately NOT an accounting document. It posts no journal, moves
 * no balance and appears in no financial statement; it exists so the work can be
 * priced and agreed before any revenue is recognised. Recognition happens when
 * the quote is converted to an invoice, which is the only path that posts.
 *
 * It still runs through `computeDocument`, so the total a customer accepts is
 * arrived at by exactly the same arithmetic — including tax — that the resulting
 * invoice will use.
 */

import { db, type Tx } from "@/lib/db";
import { addDays, toUtcDay } from "@/lib/dates";
import { loadTaxCodes } from "@/server/tax/engine";
import { computeDocument, type RawLine } from "./lines";
import { nextNumber } from "./numbering";

/** How long a quote stands for when the caller does not say. */
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

export async function createEstimate(input: EstimateInput) {
  return db.$transaction((tx) => createEstimateInTx(tx, input));
}

export async function createEstimateInTx(tx: Tx, input: EstimateInput) {
  const issueDate = toUtcDay(input.issueDate);

  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, companyId: input.companyId },
    select: { id: true },
  });
  if (!customer) throw new Error("Customer not found in this company.");

  const expiryDate = input.expiryDate
    ? toUtcDay(input.expiryDate)
    : addDays(issueDate, DEFAULT_QUOTE_VALIDITY_DAYS);
  if (expiryDate < issueDate) {
    throw new Error("A quote cannot expire before the day it is issued.");
  }

  const taxCodes = await loadTaxCodes(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
  const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);
  const number = input.number ?? (await nextNumber(tx, input.companyId, "estimate"));

  return tx.estimate.create({
    data: {
      companyId: input.companyId,
      customerId: input.customerId,
      number,
      issueDate,
      expiryDate,
      status: "DRAFT",
      memo: input.memo,
      terms: input.terms,
      taxInclusive: input.taxInclusive ?? false,
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      lines: {
        create: doc.lines.map((l) => ({
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
        })),
      },
    },
    include: { lines: true, customer: true },
  });
}

/**
 * Move a quote along its lifecycle: DRAFT → SENT → ACCEPTED or DECLINED.
 *
 * CONVERTED is not settable here — that status is a consequence of an invoice
 * being raised from the quote, not something a user declares.
 */
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
) {
  const estimate = await db.estimate.findFirst({
    where: { id: estimateId, companyId },
    select: { id: true, number: true, status: true },
  });
  if (!estimate) throw new Error("Quote not found in this company.");
  if (estimate.status === "CONVERTED") {
    throw new Error(`Quote ${estimate.number} has already been converted to an invoice.`);
  }
  if (!FORWARD[estimate.status]?.includes(status)) {
    throw new Error(`A ${estimate.status.toLowerCase()} quote cannot move to ${status.toLowerCase()}.`);
  }

  return db.estimate.update({ where: { id: estimate.id }, data: { status } });
}
