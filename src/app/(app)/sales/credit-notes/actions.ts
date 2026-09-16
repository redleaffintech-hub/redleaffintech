"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { db } from "@/lib/db";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { createCreditNote, createCustomerCreditNoteFromInvoice, voidCreditNote } from "@/server/documents/credit-notes";

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
      entityType: "CreditNote",
      entityId: creditNote.id,
      summary: `Raised customer credit note ${creditNote.number}`,
    });

    revalidatePath("/sales/credit-notes");
    revalidatePath("/sales/invoices");
    revalidatePath("/dashboard");
    return { redirectTo: `/sales/credit-notes/${creditNote.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Options for the "return goods from an invoice" flow (issue 10): the
 * source invoice's lines plus how much of each is still returnable. */
export async function invoiceReturnOptions(invoiceId: string) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);

  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, companyId: company.id },
    include: {
      customer: { select: { id: true, name: true } },
      lines: { orderBy: { lineNo: "asc" }, include: { item: true } },
    },
  });
  if (!invoice) return { error: "Invoice not found in this company." };
  if (!invoice.journalEntryId) return { error: `Invoice ${invoice.number} has not been posted yet.` };

  const priorReturns = await db.creditNoteLine.groupBy({
    by: ["sourceInvoiceLineId"],
    where: {
      sourceInvoiceLineId: { in: invoice.lines.map((l) => l.id) },
      creditNote: { companyId: company.id, status: { not: "VOID" } },
    },
    _sum: { quantityMilli: true },
  });
  const returnedByLine = new Map(priorReturns.map((r) => [r.sourceInvoiceLineId, r._sum.quantityMilli ?? 0]));

  return {
    invoice: {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      customer: invoice.customer,
    },
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      itemCode: line.item?.code ?? null,
      quantityMilli: line.quantityMilli,
      remainingMilli: line.quantityMilli - (returnedByLine.get(line.id) ?? 0),
      unitPriceCents: line.unitPriceCents,
      netCents: line.netCents,
    })),
  };
}

const returnLineSchema = z.object({ invoiceLineId: z.string(), quantity: z.number().positive() });
const returnSchema = z.object({
  invoiceId: z.string(),
  issueDate: z.string(),
  reason: z.string().optional(),
  returns: z.array(returnLineSchema).min(1),
});

/** Create a customer credit note that returns specific quantities from a
 * posted invoice (issue 10) — restocks tracked items at the ORIGINAL sale
 * cost and reverses the exact tax that was charged, not today's rates. */
export async function createReturnFromInvoiceAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  const parsed = returnSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the return and try again." };

  try {
    const creditNote = await createCustomerCreditNoteFromInvoice({
      companyId: company.id,
      invoiceId: parsed.data.invoiceId,
      issueDate: parsed.data.issueDate,
      reason: parsed.data.reason || "Return of goods",
      returns: parsed.data.returns.map((r) => ({
        invoiceLineId: r.invoiceLineId,
        quantityMilli: Math.round(r.quantity * 1000),
      })),
      userId: user.id,
    });

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "CREATE",
      entityType: "CreditNote",
      entityId: creditNote.id,
      summary: `Raised return credit note ${creditNote.number} from invoice`,
    });

    revalidatePath("/sales/credit-notes");
    revalidatePath("/sales/invoices");
    revalidatePath("/inventory");
    revalidatePath("/dashboard");
    return { redirectTo: `/sales/credit-notes/${creditNote.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function voidCreditNoteAction(creditNoteId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  try {
    const credit = await voidCreditNote(creditNoteId, company.id, user.id);
    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "VOID",
      entityType: "CreditNote",
      entityId: creditNoteId,
      summary: `Voided credit note ${credit.number}`,
    });
    revalidatePath("/sales/credit-notes");
    revalidatePath(`/sales/credit-notes/${creditNoteId}`);
    revalidatePath("/inventory");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
