"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { createEstimate, setEstimateStatus } from "@/server/documents/estimates";
import { peekNumber } from "@/server/documents/numbering";

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.string(),
  discountPercent: z.number().min(0).max(100).default(0),
  accountId: z.string().min(1),
  taxCodeId: z.string().nullable(),
  itemId: z.string().nullable(),
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
      userId: user.id,
      lines: parsed.data.lines.map((line) => ({
        accountId: line.accountId,
        description: line.description,
        quantityMilli: Math.round(line.quantity * 1000),
        unitPriceCents: toCents(line.unitPrice),
        discountPercentMicro: Math.round(line.discountPercent * 1_000_000),
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
    return { redirectTo: "/sales/quotes" };
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
