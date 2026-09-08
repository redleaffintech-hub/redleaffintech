"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { PROVINCES_WITH_SALES_TAX } from "@/server/setup/templates";
import { requireCapability, requireCompany, recordAudit } from "@/server/auth/context";
import { createInvoice, postInvoice, updateInvoice, voidInvoice } from "@/server/documents/invoices";
import { peekNumber } from "@/server/documents/numbering";
import { recordPayment } from "@/server/documents/payments";
import { writeOffInvoice } from "@/server/documents/credit-notes";

const lineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.string(),
  discountPercent: z.number().min(0).max(100).default(0),
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

const invoiceSchema = z.object({
  partyId: z.string().min(1),
  number: z.string().max(40).optional(),
  issueDate: z.string(),
  dueDate: z.string(),
  taxInclusive: z.boolean(),
  memo: z.string().optional(),
  reference: z.string().optional(),
  post: z.boolean(),
  billTo: addressSchema.optional(),
  /** Null is meaningful: "ship to the billing address". */
  shipTo: addressSchema.nullable().optional(),
  lines: z.array(lineSchema).min(1),
});

export async function createInvoiceAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  const parsed = invoiceSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  /**
   * The editor shows the number the next invoice would take. Handing that same
   * value back means "you allocate it" — so the counter is incremented atomically
   * at save time and two people who opened the form together cannot collide. Only
   * a number the user typed over is treated as an explicit override, and an
   * override deliberately leaves the counter alone.
   */
  const suggested = await peekNumber(db, company.id, "invoice");
  const supplied = parsed.data.number?.trim();
  const explicitNumber = supplied && supplied !== suggested ? supplied : undefined;

  if (explicitNumber) {
    const clash = await db.invoice.findFirst({
      where: { companyId: company.id, number: explicitNumber },
      select: { id: true },
    });
    if (clash) return { error: `Invoice ${explicitNumber} already exists. Choose another number.` };
  }

  try {
    const invoice = await createInvoice({
      companyId: company.id,
      customerId: parsed.data.partyId,
      number: explicitNumber,
      issueDate: parsed.data.issueDate,
      dueDate: parsed.data.dueDate,
      memo: parsed.data.memo || undefined,
      poNumber: parsed.data.reference || undefined,
      taxInclusive: parsed.data.taxInclusive,
      billTo: parsed.data.billTo,
      shipTo: parsed.data.shipTo,
      userId: user.id,
      post: parsed.data.post,
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

    revalidatePath("/sales/invoices");
    revalidatePath("/");
    return { redirectTo: `/sales/invoices/${invoice.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function updateInvoiceAction(invoiceId: string, payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  const parsed = invoiceSchema.safeParse(JSON.parse(payload));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await updateInvoice({
      invoiceId,
      companyId: company.id,
      customerId: parsed.data.partyId,
      issueDate: parsed.data.issueDate,
      dueDate: parsed.data.dueDate,
      memo: parsed.data.memo || undefined,
      poNumber: parsed.data.reference || undefined,
      taxInclusive: parsed.data.taxInclusive,
      billTo: parsed.data.billTo,
      shipTo: parsed.data.shipTo,
      userId: user.id,
      post: parsed.data.post,
      // The number is fixed once an invoice exists — updateInvoice ignores it.
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

    revalidatePath("/sales/invoices");
    revalidatePath(`/sales/invoices/${invoiceId}`);
    revalidatePath("/");
    return { redirectTo: `/sales/invoices/${invoiceId}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function postInvoiceAction(invoiceId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  try {
    await postInvoice(invoiceId, company.id, user.id);
    revalidatePath(`/sales/invoices/${invoiceId}`);
    revalidatePath("/sales/invoices");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function voidInvoiceAction(invoiceId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  try {
    await voidInvoice(invoiceId, company.id, user.id);
    revalidatePath(`/sales/invoices/${invoiceId}`);
    revalidatePath("/sales/invoices");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function markInvoiceSentAction(invoiceId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, companyId: company.id } });
  if (!invoice) return { error: "Invoice not found." };
  await db.invoice.update({ where: { id: invoiceId }, data: { sentAt: new Date() } });
  await recordAudit({
    companyId: company.id, userId: user.id, action: "UPDATE", entityType: "Invoice",
    entityId: invoiceId, summary: `Marked ${invoice.number} as sent to the customer`,
  });
  revalidatePath(`/sales/invoices/${invoiceId}`);
  return { ok: true };
}

const receiptSchema = z.object({
  invoiceId: z.string(),
  amount: z.string(),
  date: z.string(),
  bankAccountId: z.string(),
  method: z.string(),
  reference: z.string().optional(),
});

export async function recordReceiptAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.PAYMENTS);
  const parsed = receiptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the payment details and try again." };

  const invoice = await db.invoice.findFirst({
    where: { id: parsed.data.invoiceId, companyId: company.id },
  });
  if (!invoice) return { error: "Invoice not found." };

  try {
    await recordPayment({
      companyId: company.id,
      type: "RECEIPT",
      date: parsed.data.date,
      customerId: invoice.customerId,
      bankAccountId: parsed.data.bankAccountId,
      amountCents: toCents(parsed.data.amount),
      method: parsed.data.method,
      reference: parsed.data.reference,
      memo: `Payment for ${invoice.number}`,
      allocations: [{ invoiceId: invoice.id, amountCents: toCents(parsed.data.amount) }],
      userId: user.id,
    });
    revalidatePath(`/sales/invoices/${invoice.id}`);
    revalidatePath("/sales/invoices");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function writeOffInvoiceAction(invoiceId: string, reason: string) {
  const { company, user } = await requireCapability(CAPABILITIES.INVOICES);
  try {
    await writeOffInvoice(company.id, invoiceId, { reason, userId: user.id });
    revalidatePath(`/sales/invoices/${invoiceId}`);
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** Options the invoice, quote and credit-note editors need, tenant-scoped. */
export async function invoiceFormOptions() {
  const { company } = await requireCompany();
  const [customerRecords, accounts, taxCodes, items, profile] = await Promise.all([
    db.customer.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, taxCodeId: true, paymentTermsDays: true, country: true,
        addressLine1: true, addressLine2: true, city: true, province: true, postalCode: true,
        shipToLine1: true, shipToLine2: true, shipToCity: true, shipToProvince: true,
        shipToPostalCode: true, shipToCountry: true,
      },
    }),
    db.account.findMany({
      where: { companyId: company.id, isActive: true, type: { in: ["REVENUE", "LIABILITY"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    db.taxCode.findMany({
      where: { companyId: company.id, isActive: true, appliesToSales: true },
      orderBy: { code: "asc" },
      include: { components: true },
    }),
    // Active items only: an archived item must not be selectable on a new
    // document, though documents that already reference one still display it.
    db.serviceItem.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: [{ code: "asc" }],
      select: {
        id: true, code: true, name: true, description: true, unit: true,
        unitPriceCents: true, discountPercentMicro: true,
        incomeAccountId: true, expenseAccountId: true,
        taxCodeId: true, purchaseTaxCodeId: true,
      },
    }),
    db.company.findUniqueOrThrow({
      where: { id: company.id },
      select: {
        name: true, legalName: true, addressLine1: true, addressLine2: true, city: true, province: true,
        postalCode: true, businessNumber: true, gstNumber: true, qstNumber: true, pstNumber: true,
        email: true, phone: true, website: true, invoiceFooter: true, logoUrl: true,
      },
    }),
  ]);

  // Flattened into the shape the editor party list wants, so the component never
  // has to know the customer table column names.
  const customers = customerRecords.map((customer) => ({
    id: customer.id,
    name: customer.name,
    taxCodeId: customer.taxCodeId,
    paymentTermsDays: customer.paymentTermsDays,
    billTo: {
      line1: customer.addressLine1,
      line2: customer.addressLine2,
      city: customer.city,
      province: customer.province,
      postalCode: customer.postalCode,
      country: customer.country,
    },
    shipTo:
      customer.shipToLine1 || customer.shipToCity || customer.shipToProvince
        ? {
            line1: customer.shipToLine1,
            line2: customer.shipToLine2,
            city: customer.shipToCity,
            province: customer.shipToProvince,
            postalCode: customer.shipToPostalCode,
            country: customer.shipToCountry ?? customer.country,
          }
        : null,
  }));

  return {
    customers,
    accounts,
    taxCodes,
    items,
    company,
    profile,
    /** The plain list the new-customer dialog offers as a default code. */
    salesTaxCodes: taxCodes.map((code) => ({ id: code.id, code: code.code, name: code.name })),
    provincesWithSalesTax: PROVINCES_WITH_SALES_TAX,
  };
}
