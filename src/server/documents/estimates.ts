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
 * invoice will use, and the same company/customer tax-suppression policy
 * (src/server/tax/policy.ts) applies to a quote preview/save as to an invoice
 * (issues 1/5, 15 Sep 2026 review).
 */

import { db, type Tx } from "@/lib/db";
import { addDays, toUtcDay } from "@/lib/dates";
import { loadTaxCodes } from "@/server/tax/engine";
import { resolveSuppressedKinds } from "@/server/tax/policy";
import { computeDocument, assertValidDiscount, type RawLine } from "./lines";
import { nextNumber } from "./numbering";
import {
  createInvoiceInTx,
  documentAddressColumns,
  type DocumentAddressInput,
  type AddressCustomer,
} from "./invoices";

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
  /** Omitted means "take it from the customer record". */
  billTo?: DocumentAddressInput | null;
  /** Null means "ship to the billing address"; omitted takes the customer default. */
  shipTo?: DocumentAddressInput | null;
}

/** The `EstimateLine` rows for a computed document, in create order. */
function lineCreateData(doc: ReturnType<typeof computeDocument>) {
  return doc.lines.map((l) => ({
    lineNo: l.lineNo,
    itemId: l.itemId ?? null,
    accountId: l.accountId,
    description: l.description,
    quantityMilli: l.quantityMilli,
    unitPriceCents: l.unitPriceCents,
    discountMode: l.discountMode,
    discountPercentMicro: l.discountPercentMicro,
    discountAmountCents: l.discountAmountCents,
    netCents: l.netCents,
    taxCodeId: l.taxCodeId ?? null,
    taxCents: l.taxCents,
    totalCents: l.totalCents,
  }));
}

export async function createEstimate(input: EstimateInput) {
  return db.$transaction((tx) => createEstimateInTx(tx, input));
}

export async function createEstimateInTx(tx: Tx, input: EstimateInput) {
  const issueDate = toUtcDay(input.issueDate);

  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, companyId: input.companyId },
  });
  if (!customer) throw new Error("Customer not found in this company.");
  const company = await tx.company.findUniqueOrThrow({
    where: { id: input.companyId },
    select: { gstHstStatus: true, qstStatus: true, pstStatus: true, quoteFooter: true },
  });

  for (const line of input.lines) assertValidDiscount(line);

  const expiryDate = input.expiryDate
    ? toUtcDay(input.expiryDate)
    : addDays(issueDate, DEFAULT_QUOTE_VALIDITY_DAYS);
  if (expiryDate < issueDate) {
    throw new Error("A quote cannot expire before the day it is issued.");
  }

  const suppressedKinds = resolveSuppressedKinds(company, customer);
  const taxCodes = await loadTaxCodes(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
  const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate, suppressedKinds);
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
      footerText: company.quoteFooter ?? null,
      ...documentAddressColumns(customer as unknown as AddressCustomer, input),
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      lines: { create: lineCreateData(doc) },
    },
    include: { lines: true, customer: true },
  });
}

export interface EstimateUpdateInput extends EstimateInput {
  estimateId: string;
}

/**
 * Edit an existing quote (issue 11, 15 Sep 2026 review — the first edit
 * support this file has ever had). A quote never posts, so unlike
 * updateInvoice there is no journal/tax/stock to unwind — this is a plain
 * transactional rewrite. Refused once the quote has been converted: the
 * linked invoice is the durable record from that point on, and must never
 * change silently because someone edited the quote that spawned it.
 */
export async function updateEstimate(input: EstimateUpdateInput) {
  return db.$transaction(async (tx) => {
    const existing = await tx.estimate.findFirst({
      where: { id: input.estimateId, companyId: input.companyId },
    });
    if (!existing) throw new Error("Quote not found in this company.");
    if (existing.status === "CONVERTED") {
      throw new Error(`Quote ${existing.number} has already been converted to an invoice and cannot be edited.`);
    }

    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, companyId: input.companyId },
    });
    if (!customer) throw new Error("Customer not found in this company.");
    const company = await tx.company.findUniqueOrThrow({
      where: { id: input.companyId },
      select: { gstHstStatus: true, qstStatus: true, pstStatus: true },
    });

    for (const line of input.lines) assertValidDiscount(line);

    const issueDate = toUtcDay(input.issueDate);
    const expiryDate = input.expiryDate
      ? toUtcDay(input.expiryDate)
      : addDays(issueDate, DEFAULT_QUOTE_VALIDITY_DAYS);
    if (expiryDate < issueDate) {
      throw new Error("A quote cannot expire before the day it is issued.");
    }

    const suppressedKinds = resolveSuppressedKinds(company, customer);
    const taxCodes = await loadTaxCodes(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
    const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate, suppressedKinds);

    await tx.estimateLine.deleteMany({ where: { estimateId: existing.id } });

    await tx.estimate.update({
      where: { id: existing.id },
      data: {
        customerId: input.customerId,
        issueDate,
        expiryDate,
        memo: input.memo ?? null,
        terms: input.terms ?? null,
        taxInclusive: input.taxInclusive ?? false,
        ...documentAddressColumns(customer as unknown as AddressCustomer, input),
        subtotalCents: doc.subtotalCents,
        taxCents: doc.taxCents,
        totalCents: doc.totalCents,
        lines: { create: lineCreateData(doc) },
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: input.companyId,
        userId: input.userId ?? null,
        action: "UPDATE",
        entityType: "Estimate",
        entityId: existing.id,
        summary: `Edited quote ${existing.number}`,
      },
    });

    return tx.estimate.findUniqueOrThrow({
      where: { id: existing.id },
      include: { lines: true, customer: true },
    });
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

export interface ConvertEstimateInput {
  companyId: string;
  estimateId: string;
  issueDate?: Date | string;
  dueDate?: Date | string;
  /** Post the resulting invoice immediately instead of leaving it a draft. */
  post?: boolean;
  userId?: string | null;
}

export async function convertEstimateToInvoice(input: ConvertEstimateInput) {
  return db.$transaction((tx) => convertEstimateToInvoiceInTx(tx, input));
}

/**
 * Convert a quote to an invoice (issue 11). Quote and invoice link to one
 * another (Estimate.convertedInvoiceId <-> Invoice.estimateId, both @unique
 * at the DB level), and the quote is marked CONVERTED only after the invoice
 * exists — inside the SAME transaction, via a conditional UPDATE that only
 * one concurrent caller can win. A losing concurrent call, or a plain retry
 * after success, throws/returns rather than creating a second invoice; a
 * genuine retry after success should re-read the quote and find `invoice`
 * already populated instead of calling this again.
 */
export async function convertEstimateToInvoiceInTx(tx: Tx, input: ConvertEstimateInput) {
  const estimate = await tx.estimate.findFirst({
    where: { id: input.estimateId, companyId: input.companyId },
    include: { lines: true, invoice: true },
  });
  if (!estimate) throw new Error("Quote not found in this company.");

  if (estimate.status === "CONVERTED") {
    if (estimate.invoice) return estimate.invoice;
    throw new Error(`Quote ${estimate.number} is marked converted but its invoice could not be found.`);
  }
  if (estimate.status === "DECLINED" || estimate.status === "EXPIRED") {
    throw new Error(`A ${estimate.status.toLowerCase()} quote cannot be converted to an invoice.`);
  }
  if (estimate.lines.length === 0) throw new Error("A quote needs at least one line to convert.");

  const issueDate = input.issueDate ? toUtcDay(input.issueDate) : toUtcDay(new Date());

  const billTo =
    estimate.billToLine1 || estimate.billToName
      ? {
          name: estimate.billToName,
          line1: estimate.billToLine1,
          line2: estimate.billToLine2,
          city: estimate.billToCity,
          province: estimate.billToProvince,
          postalCode: estimate.billToPostalCode,
          country: estimate.billToCountry,
        }
      : undefined; // no snapshot on this (pre-feature) quote — fall back to the customer's current address
  const shipTo = estimate.shipToLine1
    ? {
        name: estimate.shipToName,
        line1: estimate.shipToLine1,
        line2: estimate.shipToLine2,
        city: estimate.shipToCity,
        province: estimate.shipToProvince,
        postalCode: estimate.shipToPostalCode,
        country: estimate.shipToCountry,
      }
    : null;

  const invoice = await createInvoiceInTx(tx, {
    companyId: input.companyId,
    customerId: estimate.customerId,
    issueDate,
    dueDate: input.dueDate,
    memo: estimate.memo ?? undefined,
    terms: estimate.terms ?? undefined,
    taxInclusive: estimate.taxInclusive,
    lines: estimate.lines.map((l) => ({
      accountId: l.accountId,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      discountMode: l.discountMode as "PERCENT" | "FIXED",
      discountPercentMicro: l.discountPercentMicro,
      discountAmountCents: l.discountAmountCents,
      taxCodeId: l.taxCodeId,
      itemId: l.itemId,
    })),
    billTo,
    shipTo,
    userId: input.userId,
    post: input.post,
  });

  // Claim the conversion — only one concurrent transaction's UPDATE can match
  // a still-unconverted status. The loser's whole transaction (invoice
  // included) rolls back rather than leaving an orphan invoice behind.
  const claim = await tx.estimate.updateMany({
    where: { id: estimate.id, status: { not: "CONVERTED" } },
    data: { status: "CONVERTED", convertedInvoiceId: invoice.id },
  });
  if (claim.count === 0) {
    throw new Error(`Quote ${estimate.number} was just converted by someone else. Reload it to see the invoice.`);
  }

  return tx.invoice.update({
    where: { id: invoice.id },
    data: { estimateId: estimate.id },
    include: { lines: true, customer: true },
  });
}
