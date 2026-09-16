"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { createEstimate, updateEstimate, setEstimateStatus, convertEstimateToInvoice } from "@/server/documents/estimates";
import { peekNumber } from "@/server/documents/numbering";

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.string(),
  discountMode: z.enum(["PERCENT", "FIXED"]).default("PERCENT"),
  discountPercent: z.number().min(0).max(100).default(0),
  discountAmount: z.string().optional(),
  accountId: z.string().min(1),
  taxCodeId: z.string().nullable(),
  itemId: z.string().nullable(),
});

/** An address as typed on the document, before it is snapshotted onto it. */
const addressSchema = z.object({
  name: z.string().max(160).optional(),
  line1: z.string().max(160).optional(),
  line2: z.string().max(160).optional(),
  city: z.string().max(80).optional(),
  province: z.string().max(2).optional(),
  postalCode: z.string().max(12).optional(),
});

const quoteSchema = z.object({
  partyId: z.string().min(1),
  number: z.string().max(40).optional(),
  issueDate: z.string(),
  /** The editor sends the second date under one name for every document kind. */
  dueDate: z.string().optional(),
  taxInclusive: z.boolean(),
  memo: z.string().optional(),
  reference: z.string().optional(),
  billTo: addressSchema.optional(),
  shipTo: addressSchema.nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

export async function createQuoteAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the quote." };
  }

  const parsed = quoteSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the quote and try again." };

  // Same rule as the invoice editor: handing back the suggested number means
  // "allocate it at save time", so concurrent quotes cannot take the same one.
  const suggested = await peekNumber(db, company.id, "estimate");
  const supplied = parsed.data.number?.trim();
  const explicitNumber = supplied && supplied !== suggested ? supplied : undefined;

  if (explicitNumber) {
    const clash = await db.estimate.findFirst({
      where: { companyId: company.id, number: explicitNumber },
      select: { id: true },
    });
    if (clash) return { error: `Quote ${explicitNumber} already exists. Choose another number.` };
  }

  try {
    const quote = await createEstimate({
      companyId: company.id,
      customerId: parsed.data.partyId,
      number: explicitNumber,
      issueDate: parsed.data.issueDate,
      expiryDate: parsed.data.dueDate || undefined,
      memo: parsed.data.memo || undefined,
      terms: parsed.data.reference || undefined,
      taxInclusive: parsed.data.taxInclusive,
      billTo: parsed.data.billTo,
      shipTo: parsed.data.shipTo,
      userId: user.id,
      lines: parsed.data.lines.map((line) => ({
        accountId: line.accountId,
        description: line.description,
        quantityMilli: Math.round(line.quantity * 1000),
        unitPriceCents: toCents(line.unitPrice),
        discountMode: line.discountMode,
        discountPercentMicro: Math.round(line.discountPercent * 1_000_000),
        discountAmountCents: line.discountAmount ? toCents(line.discountAmount) : 0,
        taxCodeId: line.taxCodeId,
        itemId: line.itemId,
      })),
    });

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "CREATE",
      entityType: "Estimate",
      entityId: quote.id,
      summary: `Created sales quote ${quote.number} for ${quote.customer.name}`,
    });

    revalidatePath("/sales/quotes");
    return { redirectTo: `/sales/quotes/${quote.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function updateQuoteAction(quoteId: string, payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  const parsed = quoteSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the quote and try again." };

  try {
    await updateEstimate({
      estimateId: quoteId,
      companyId: company.id,
      customerId: parsed.data.partyId,
      issueDate: parsed.data.issueDate,
      expiryDate: parsed.data.dueDate || undefined,
      memo: parsed.data.memo || undefined,
      terms: parsed.data.reference || undefined,
      taxInclusive: parsed.data.taxInclusive,
      billTo: parsed.data.billTo,
      shipTo: parsed.data.shipTo,
      userId: user.id,
      lines: parsed.data.lines.map((line) => ({
        accountId: line.accountId,
        description: line.description,
        quantityMilli: Math.round(line.quantity * 1000),
        unitPriceCents: toCents(line.unitPrice),
        discountMode: line.discountMode,
        discountPercentMicro: Math.round(line.discountPercent * 1_000_000),
        discountAmountCents: line.discountAmount ? toCents(line.discountAmount) : 0,
        taxCodeId: line.taxCodeId,
        itemId: line.itemId,
      })),
    });

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "Estimate",
      entityId: quoteId,
      summary: "Edited sales quote",
    });

    revalidatePath("/sales/quotes");
    revalidatePath(`/sales/quotes/${quoteId}`);
    return { redirectTo: `/sales/quotes/${quoteId}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Convert a quote to an invoice (issue 11). `post` mirrors the editor's own
 * draft/issue choice on the resulting invoice. */
export async function convertQuoteAction(quoteId: string, opts: { issueDate?: string; dueDate?: string; post: boolean }) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  try {
    const invoice = await convertEstimateToInvoice({
      companyId: company.id,
      estimateId: quoteId,
      issueDate: opts.issueDate,
      dueDate: opts.dueDate,
      post: opts.post,
      userId: user.id,
    });
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "Estimate",
      entityId: quoteId,
      summary: `Converted sales quote to invoice ${invoice.number}`,
    });
    revalidatePath("/sales/quotes");
    revalidatePath(`/sales/quotes/${quoteId}`);
    revalidatePath("/sales/invoices");
    return { ok: true as const, invoiceId: invoice.id };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function setQuoteStatusAction(quoteId: string, status: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  try {
    const quote = await setEstimateStatus(company.id, quoteId, status);
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "Estimate",
      entityId: quote.id,
      summary: `Marked sales quote ${quote.number} as ${status.toLowerCase()}`,
    });
    revalidatePath("/sales/quotes");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
