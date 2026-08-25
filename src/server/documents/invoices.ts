/**
 * Sales invoices (spec §8, §33 Invoice workflow).
 *
 * Posting rule
 *   Dr  Accounts Receivable            invoice total
 *     Cr  Revenue account(s)             line net, per account
 *     Cr  GST/HST (or PST/QST) Payable   tax, per component
 */

import { db, type Tx } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { addDays, toUtcDay } from "@/lib/dates";
import { getSystemAccount, postJournal, reverseJournal } from "@/server/accounting/ledger";
import { loadTaxCodes, recordTaxEntries } from "@/server/tax/engine";
import { consumeStock, reverseStockMovement } from "@/server/inventory/costing";
import { computeDocument, netByAccount, type RawLine } from "./lines";
import { nextNumber } from "./numbering";

/**
 * An address as recorded ON the document. Snapshotted rather than read through
 * the customer relation: an issued invoice is a record of what was sent, and
 * editing the customer later must not rewrite it.
 */
export interface DocumentAddressInput {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface InvoiceInput {
  companyId: string;
  customerId: string;
  issueDate: Date | string;
  dueDate?: Date | string;
  number?: string;
  memo?: string;
  terms?: string;
  poNumber?: string;
  projectId?: string | null;
  taxInclusive?: boolean;
  lines: RawLine[];
  userId?: string | null;
  /** Post to the ledger immediately instead of leaving a draft. */
  post?: boolean;
  /** Omitted means "take it from the customer record". */
  billTo?: DocumentAddressInput | null;
  /** Null means "ship to the billing address"; omitted takes the customer default. */
  shipTo?: DocumentAddressInput | null;
}

function blankAddress(address: DocumentAddressInput | null | undefined) {
  if (!address) return true;
  return !address.line1 && !address.line2 && !address.city && !address.province && !address.postalCode;
}

export async function createInvoice(input: InvoiceInput) {
  return db.$transaction(async (tx) => {
    const invoice = await createInvoiceInTx(tx, input);
    if (input.post) return postInvoiceInTx(tx, invoice.id, input.companyId, input.userId);
    return invoice;
  });
}

export async function createInvoiceInTx(tx: Tx, input: InvoiceInput) {
  const issueDate = toUtcDay(input.issueDate);
  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, companyId: input.companyId },
  });
  if (!customer) throw new Error("Customer not found in this company.");

  const dueDate = input.dueDate
    ? toUtcDay(input.dueDate)
    : addDays(issueDate, customer.paymentTermsDays);

  const taxCodes = await loadTaxCodes(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
  const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);
  const number = input.number ?? (await nextNumber(tx, input.companyId, "invoice"));

  // Fall back to the customer record for anything the caller did not state, so
  // an invoice raised by the seed, a recurring template or the API still carries
  // a complete address rather than an empty one.
  const billTo =
    input.billTo && !blankAddress(input.billTo)
      ? input.billTo
      : {
          name: customer.name,
          line1: customer.addressLine1,
          line2: customer.addressLine2,
          city: customer.city,
          province: customer.province,
          postalCode: customer.postalCode,
          country: customer.country,
        };

  const shipTo =
    input.shipTo === null
      ? null
      : input.shipTo && !blankAddress(input.shipTo)
        ? input.shipTo
        : blankAddress({
              line1: customer.shipToLine1,
              city: customer.shipToCity,
              province: customer.shipToProvince,
              postalCode: customer.shipToPostalCode,
            })
          ? null
          : {
              name: customer.name,
              line1: customer.shipToLine1,
              line2: customer.shipToLine2,
              city: customer.shipToCity,
              province: customer.shipToProvince,
              postalCode: customer.shipToPostalCode,
              country: customer.shipToCountry ?? customer.country,
            };

  return tx.invoice.create({
    data: {
      companyId: input.companyId,
      customerId: input.customerId,
      number,
      issueDate,
      dueDate,
      status: "DRAFT",
      memo: input.memo,
      terms: input.terms,
      poNumber: input.poNumber,
      projectId: input.projectId ?? null,
      taxInclusive: input.taxInclusive ?? false,

      billToName: billTo.name ?? customer.name,
      billToLine1: billTo.line1 ?? null,
      billToLine2: billTo.line2 ?? null,
      billToCity: billTo.city ?? null,
      billToProvince: billTo.province ?? null,
      billToPostalCode: billTo.postalCode ?? null,
      billToCountry: billTo.country ?? customer.country,

      shipToName: shipTo?.name ?? null,
      shipToLine1: shipTo?.line1 ?? null,
      shipToLine2: shipTo?.line2 ?? null,
      shipToCity: shipTo?.city ?? null,
      shipToProvince: shipTo?.province ?? null,
      shipToPostalCode: shipTo?.postalCode ?? null,
      shipToCountry: shipTo ? (shipTo.country ?? customer.country) : null,
      subtotalCents: doc.subtotalCents,
      discountCents: doc.discountCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      balanceCents: doc.totalCents,
      createdById: input.userId ?? null,
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
          projectId: l.projectId ?? null,
        })),
      },
    },
    include: { lines: true, customer: true },
  });
}

export async function postInvoice(invoiceId: string, companyId: string, userId?: string | null) {
  return db.$transaction((tx) => postInvoiceInTx(tx, invoiceId, companyId, userId));
}

export async function postInvoiceInTx(
  tx: Tx,
  invoiceId: string,
  companyId: string,
  userId?: string | null,
) {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, companyId },
    include: { lines: true, customer: true },
  });
  if (!invoice) throw new Error("Invoice not found in this company.");
  if (invoice.journalEntryId) throw new Error(`Invoice ${invoice.number} is already posted.`);
  if (invoice.status === "VOID") throw new Error(`Invoice ${invoice.number} is void.`);
  if (invoice.lines.length === 0) throw new Error("An invoice needs at least one line.");

  // Recompute from the line inputs so the ledger can never disagree with the
  // document, and so tax is rated as of the invoice date.
  const taxCodes = await loadTaxCodes(tx, companyId, invoice.lines.map((l) => l.taxCodeId));
  const doc = computeDocument(
    invoice.lines.map((l) => ({
      accountId: l.accountId,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      discountPercentMicro: l.discountPercentMicro,
      taxCodeId: l.taxCodeId,
      itemId: l.itemId,
      projectId: l.projectId,
    })),
    taxCodes,
    invoice.taxInclusive,
    invoice.issueDate,
  );

  const ar = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE);

  // Selling a tracked-inventory item also moves its weighted-average cost out
  // of Inventory Asset into COGS, on the same journal entry as the sale.
  const itemIds = doc.lines.map((l) => l.itemId).filter((id): id is string => Boolean(id));
  const trackedItems = itemIds.length
    ? await tx.serviceItem.findMany({
        where: { id: { in: itemIds }, companyId, trackInventory: true },
        select: { id: true, expenseAccountId: true },
      })
    : [];
  const trackedItemById = new Map(trackedItems.map((i) => [i.id, i]));

  let cogsLines: { accountId: string; debitCents?: number; creditCents?: number; description: string; customerId: string }[] = [];
  if (trackedItemById.size > 0) {
    const inventoryAsset = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.INVENTORY_ASSET);
    const systemCogs = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.COST_OF_GOODS_SOLD);
    const cogsByAccount = new Map<string, number>();
    let totalCogsCents = 0;

    for (const line of doc.lines) {
      const item = line.itemId ? trackedItemById.get(line.itemId) : undefined;
      if (!item) continue;
      const { totalCostCents } = await consumeStock(tx, {
        companyId,
        itemId: item.id,
        date: invoice.issueDate,
        quantityMilli: line.quantityMilli,
        sourceType: "INVOICE",
        sourceId: invoice.id,
        sourceNumber: invoice.number,
        userId,
      });
      const cogsAccountId = item.expenseAccountId ?? systemCogs.id;
      cogsByAccount.set(cogsAccountId, (cogsByAccount.get(cogsAccountId) ?? 0) + totalCostCents);
      totalCogsCents += totalCostCents;
    }

    cogsLines = [
      ...[...cogsByAccount.entries()].map(([accountId, cents]) => ({
        accountId,
        debitCents: cents,
        description: `Cost of goods sold — ${invoice.number}`,
        customerId: invoice.customerId,
      })),
      { accountId: inventoryAsset.id, creditCents: totalCogsCents, description: `Stock sold — ${invoice.number}`, customerId: invoice.customerId },
    ];
  }

  const journalLines = [
    {
      accountId: ar.id,
      debitCents: doc.totalCents,
      description: `${invoice.customer.name} — ${invoice.number}`,
      customerId: invoice.customerId,
    },
    ...netByAccount(doc.lines).map((entry) => ({
      accountId: entry.accountId,
      creditCents: entry.netCents,
      description: invoice.memo ?? `Invoice ${invoice.number}`,
      customerId: invoice.customerId,
      projectId: invoice.projectId,
      taxCodeId: entry.taxCodeId,
    })),
    ...doc.taxByComponent
      .filter((c) => c.taxCents !== 0)
      .map((c) => {
        if (!c.liabilityAccountId) {
          throw new Error(`Tax component ${c.name} has no liability account configured.`);
        }
        return {
          accountId: c.liabilityAccountId,
          creditCents: c.taxCents,
          description: `${c.name} on ${invoice.number}`,
          customerId: invoice.customerId,
        };
      }),
    ...cogsLines,
  ];

  const entry = await postJournal(tx, {
    companyId,
    date: invoice.issueDate,
    memo: `Invoice ${invoice.number} — ${invoice.customer.name}`,
    sourceType: "INVOICE",
    sourceId: invoice.id,
    sourceNumber: invoice.number,
    createdById: userId,
    lines: journalLines,
  });

  if (trackedItemById.size > 0) {
    await tx.inventoryMovement.updateMany({
      where: { companyId, sourceType: "INVOICE", sourceId: invoice.id, journalEntryId: null },
      data: { journalEntryId: entry.id },
    });
  }

  // One tax audit row per component per line (§7).
  for (const line of doc.lines) {
    if (!line.taxCodeId || line.taxComponents.length === 0) continue;
    await recordTaxEntries(tx, {
      companyId,
      date: invoice.issueDate,
      direction: "SALE",
      sourceType: "INVOICE",
      sourceId: invoice.id,
      sourceNumber: invoice.number,
      taxCodeId: line.taxCodeId,
      jurisdiction: line.jurisdiction,
      partyName: invoice.customer.name,
      journalEntryId: entry.id,
      components: line.taxComponents,
    });
  }

  return tx.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "SENT",
      journalEntryId: entry.id,
      postedAt: new Date(),
      subtotalCents: doc.subtotalCents,
      discountCents: doc.discountCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      balanceCents: doc.totalCents - invoice.amountPaidCents,
    },
    include: { lines: true, customer: true },
  });
}

/**
 * Void a posted invoice by reversing its journal (§5.1 — never mutate history).
 * Refuses if cash has already been applied; unapply the receipt first.
 */
export async function voidInvoice(invoiceId: string, companyId: string, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { allocations: true },
    });
    if (!invoice) throw new Error("Invoice not found in this company.");
    if (invoice.status === "VOID") throw new Error("Invoice is already void.");
    if (invoice.amountPaidCents !== 0) {
      throw new Error("Unapply the payments on this invoice before voiding it.");
    }

    if (invoice.journalEntryId) {
      await reverseJournal(tx, invoice.journalEntryId, {
        companyId,
        memo: `Void invoice ${invoice.number}`,
        userId,
      });
      // Reverse the tax audit rows too, so tax reports stop counting it.
      const original = await tx.taxEntry.findMany({
        where: { companyId, sourceType: "INVOICE", sourceId: invoice.id },
      });
      if (original.length) {
        await tx.taxEntry.createMany({
          data: original.map((t) => ({
            companyId,
            date: t.date,
            direction: t.direction,
            sourceType: "INVOICE",
            sourceId: invoice.id,
            sourceNumber: `${invoice.number} (void)`,
            taxCodeId: t.taxCodeId,
            taxComponentId: t.taxComponentId,
            jurisdiction: t.jurisdiction,
            kind: t.kind,
            rateMicro: t.rateMicro,
            taxableCents: -t.taxableCents,
            taxCents: -t.taxCents,
            recoverableCents: -t.recoverableCents,
            taxPeriodId: t.taxPeriodId,
            partyName: t.partyName,
          })),
        });
      }
      const stockMovements = await tx.inventoryMovement.findMany({
        where: { companyId, sourceType: "INVOICE", sourceId: invoice.id, type: "SALE" },
      });
      for (const movement of stockMovements) await reverseStockMovement(tx, movement.id, userId);
    }

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: "VOID",
        entityType: "Invoice",
        entityId: invoice.id,
        summary: `Voided invoice ${invoice.number}`,
      },
    });

    return tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "VOID", voidedAt: new Date(), balanceCents: 0 },
    });
  });
}

/** Recompute paid / balance / status from the allocations actually recorded. */
export async function refreshInvoiceStatus(tx: Tx, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { allocations: true },
  });
  if (!invoice || invoice.status === "VOID" || invoice.status === "DRAFT") return invoice;

  // Every allocation settles the invoice; only PAYMENT allocations are cash.
  const settled = invoice.allocations.reduce((s, a) => s + a.amountCents, 0);
  const cashPaid = invoice.allocations
    .filter((a) => a.kind === "PAYMENT")
    .reduce((s, a) => s + a.amountCents, 0);
  const balance = invoice.totalCents - settled;

  let status = invoice.status;
  if (balance <= 0) status = "PAID";
  else if (settled > 0) status = "PARTIALLY_PAID";
  else status = new Date() > invoice.dueDate ? "OVERDUE" : "SENT";

  return tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaidCents: cashPaid, balanceCents: balance, status },
  });
}

/** Nightly-job equivalent: flip open invoices past their due date to OVERDUE. */
export async function markOverdueInvoices(companyId: string, asOf = new Date()) {
  return db.invoice.updateMany({
    where: {
      companyId,
      status: { in: ["SENT", "PARTIALLY_PAID"] },
      dueDate: { lt: asOf },
      balanceCents: { gt: 0 },
    },
    data: { status: "OVERDUE" },
  });
}
