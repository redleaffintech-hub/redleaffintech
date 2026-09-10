"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { createCreditNote } from "@/server/documents/credit-notes-fs";

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.string(),
  discountPercent: z.number().min(0).max(100).default(0),
  accountId: z.string().min(1),
  taxCodeId: z.string().nullable(),
  itemId: z.string().nullable(),
});

const creditNoteSchema = z.object({
  partyId: z.string().min(1),
  issueDate: z.string(),
  taxInclusive: z.boolean(),
  memo: z.string().optional(),
  /** The editor sends the reason in the reference slot. */
  reference: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

/**
 * Raise a customer credit note.
 *
 * There is no draft state: a credit note exists to reverse revenue and the tax
 * that went with it, and holding one unposted would leave the receivable
 * overstated for as long as it sat there. `createCreditNote` posts it in the same
 * transaction that creates it.
 */
export async function createCustomerCreditNoteAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the credit note." };
  }

  const parsed = creditNoteSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the credit note and try again." };
  }

  try {
    const creditNote = await createCreditNote({
      companyId: company.id,
      type: "CUSTOMER",
      customerId: parsed.data.partyId,
      issueDate: parsed.data.issueDate,
      reason: parsed.data.reference || undefined,
      memo: parsed.data.memo || undefined,
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
      entityType: "CreditNote",
      entityId: creditNote.id,
      summary: `Raised customer credit note ${creditNote.number}`,
    });

    revalidatePath("/sales/credit-notes");
    revalidatePath("/sales/invoices");
    revalidatePath("/dashboard");
    return { redirectTo: "/sales/credit-notes" };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
