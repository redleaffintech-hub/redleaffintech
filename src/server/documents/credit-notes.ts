/**
 * Credit notes (spec §8 customer credits, §9 vendor credits).
 *
 * Customer credit             Vendor credit
 *   Dr  Revenue      net        Dr  Accounts Payable  total
 *   Dr  Tax payable  tax          Cr  Expense           net
 *     Cr  A/R          total       Cr  ITC recoverable   tax
 */

import { db, type Tx } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { toUtcDay } from "@/lib/dates";
import { prorateCents } from "@/lib/money";
import { getSystemAccount, postJournal, reverseJournal } from "@/server/accounting/ledger";
import { loadTaxCodes, recordTaxEntries, calculateTax, type ComponentTax, type TaxCodeSpec } from "@/server/tax/engine";
import { receiveStock, returnToVendor, reverseStockMovement } from "@/server/inventory/costing";
import { computeDocument, netByAccount, splitPurchaseDebits, type RawLine } from "./lines";
import { nextNumber } from "./numbering";
import { refreshInvoiceStatus } from "./invoices";

export interface CreditNoteInput {
  companyId: string;
  type: "CUSTOMER" | "VENDOR";
  customerId?: string | null;
  vendorId?: string | null;
  issueDate: Date | string;
  reason?: string;
  memo?: string;
  taxInclusive?: boolean;
  lines: RawLine[];
  userId?: string | null;
}

export async function createCreditNote(input: CreditNoteInput) {
  return db.$transaction(async (tx) => {
    const issueDate = toUtcDay(input.issueDate);
    const taxCodes = await loadTaxCodes(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
    const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);
    const number = await nextNumber(tx, input.companyId, "credit");

    const party =
      input.type === "CUSTOMER"
        ? await tx.customer.findFirst({ where: { id: input.customerId!, companyId: input.companyId } })
        : await tx.vendor.findFirst({ where: { id: input.vendorId!, companyId: input.companyId } });
    if (!party) throw new Error("Customer or vendor not found in this company.");
    const company = await tx.company.findUniqueOrThrow({
      where: { id: input.companyId },
      select: { creditNoteFooter: true },
    });

    const creditNote = await tx.creditNote.create({
      data: {
        companyId: input.companyId,
        type: input.type,
        customerId: input.customerId ?? null,
        vendorId: input.vendorId ?? null,
        number,
        issueDate,
        status: "OPEN",
        reason: input.reason,
        memo: input.memo,
        taxInclusive: input.taxInclusive ?? false,
        footerText: company.creditNoteFooter ?? null,
        subtotalCents: doc.subtotalCents,
        taxCents: doc.taxCents,
        totalCents: doc.totalCents,
        balanceCents: doc.totalCents,
        lines: {
          create: doc.lines.map((l) => ({
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
          })),
        },
      },
      include: { lines: true },
    });

    const journalLines =
      input.type === "CUSTOMER"
        ? [
            ...netByAccount(doc.lines).map((entry) => ({
              accountId: entry.accountId, debitCents: entry.netCents, description: `Credit ${number}`,
              customerId: input.customerId, taxCodeId: entry.taxCodeId,
            })),
            ...doc.taxByComponent
              .filter((c) => c.taxCents !== 0 && c.liabilityAccountId)
              .map((c) => ({
                accountId: c.liabilityAccountId!, debitCents: c.taxCents,
                description: `${c.name} reversal on ${number}`, customerId: input.customerId,
              })),
            {
              accountId: (await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE)).id,
              creditCents: doc.totalCents,
              description: `${party.name} — ${number}`,
              customerId: input.customerId,
            },
          ]
        : await (async () => {
            const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(doc.lines);
            const ap = await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE);
            return [
              { accountId: ap.id, debitCents: doc.totalCents, description: `${party.name} — ${number}`, vendorId: input.vendorId },
              ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({
                accountId, creditCents: cents, description: `Credit ${number}`, vendorId: input.vendorId,
              })),
              ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
                accountId, creditCents: cents, description: `ITC reversal — ${number}`, vendorId: input.vendorId,
              })),
            ];
          })();

    const entry = await postJournal(tx, {
      companyId: input.companyId,
      date: issueDate,
      memo: `Credit note ${number} — ${party.name}`,
      sourceType: "CREDIT_NOTE",
      sourceId: creditNote.id,
      sourceNumber: number,
      createdById: input.userId,
      lines: journalLines,
    });

    // Negated so tax reports net the credit against the original sale/purchase.
    for (const line of doc.lines) {
      if (!line.taxCodeId || line.taxComponents.length === 0) continue;
      await recordTaxEntries(tx, {
        companyId: input.companyId,
        date: issueDate,
        direction: input.type === "CUSTOMER" ? "SALE" : "PURCHASE",
        sourceType: "CREDIT_NOTE",
        sourceId: creditNote.id,
        sourceNumber: number,
        taxCodeId: line.taxCodeId,
        jurisdiction: line.jurisdiction,
        partyName: party.name,
        journalEntryId: entry.id,
        components: line.taxComponents,
        negate: true,
      });
    }

    return tx.creditNote.update({
      where: { id: creditNote.id },
      data: { journalEntryId: entry.id, postedAt: new Date() },
      include: { lines: true },
    });
  });
}

/** Apply an open customer credit against one or more invoices. */
export async function applyCreditNote(
  companyId: string,
  creditNoteId: string,
  allocations: { invoiceId: string; amountCents: number }[],
) {
  return db.$transaction(async (tx) => {
    const credit = await tx.creditNote.findFirst({ where: { id: creditNoteId, companyId } });
    if (!credit) throw new Error("Credit note not found in this company.");

    const requested = allocations.reduce((s, a) => s + a.amountCents, 0);
    if (requested > credit.balanceCents) {
      throw new Error(`Only $${(credit.balanceCents / 100).toFixed(2)} of this credit remains.`);
    }

    await tx.paymentAllocation.createMany({
      data: allocations.map((a) => ({
        creditNoteId,
        invoiceId: a.invoiceId,
        kind: "CREDIT",
        amountCents: a.amountCents,
        date: new Date(),
      })),
    });

    const applied = credit.appliedCents + requested;
    await tx.creditNote.update({
      where: { id: creditNoteId },
      data: {
        appliedCents: applied,
        balanceCents: credit.totalCents - applied,
        status: credit.totalCents - applied <= 0 ? "APPLIED" : "PARTIALLY_APPLIED",
      },
    });

    for (const a of allocations) await refreshInvoiceStatus(tx, a.invoiceId);
    return tx.creditNote.findUnique({ where: { id: creditNoteId } });
  });
}

/** Write an uncollectible invoice off to bad debt (§8). */
export async function writeOffInvoice(
  companyId: string,
  invoiceId: string,
  opts: { date?: Date; reason?: string; userId?: string | null } = {},
) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { customer: true },
    });
    if (!invoice) throw new Error("Invoice not found in this company.");
    if (invoice.balanceCents <= 0) throw new Error("This invoice has no outstanding balance.");

    const badDebt = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.BAD_DEBT_EXPENSE);
    const ar = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE);
    const date = opts.date ? toUtcDay(opts.date) : new Date();

    await postJournal(tx, {
      companyId,
      date,
      memo: opts.reason ?? `Write-off of invoice ${invoice.number}`,
      sourceType: "ADJUSTMENT",
      sourceId: invoice.id,
      sourceNumber: invoice.number,
      createdById: opts.userId,
      lines: [
        { accountId: badDebt.id, debitCents: invoice.balanceCents, description: `Bad debt — ${invoice.customer.name}`, customerId: invoice.customerId },
        { accountId: ar.id, creditCents: invoice.balanceCents, description: `Write-off ${invoice.number}`, customerId: invoice.customerId },
      ],
    });

    // Recorded as an allocation so the aging report can date the write-off and
    // still tie to the A/R control account on any as-of date.
    await tx.paymentAllocation.create({
      data: { invoiceId, kind: "WRITE_OFF", amountCents: invoice.balanceCents, date },
    });

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        writtenOffCents: invoice.writtenOffCents + invoice.balanceCents,
        balanceCents: 0,
        status: "PAID",
      },
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Linked returns (issues 3/4/10, 15 Sep 2026 review)
//
// A return line reverses a specific InvoiceLine/BillLine, never a fresh tax
// calculation: netCents/taxCents are proportioned from that historical
// line's own already-posted amounts (prorateCents), using the SOURCE
// document's issueDate and tax code so an expired code still reverses
// correctly. This is what "reverse the original transaction's treatment,
// not today's company setting" means in code — no suppressedKinds lookup
// happens here at all.
// ─────────────────────────────────────────────────────────────────────────────

/** How much of a source line has not already been returned, across every
 * non-void credit note linked to it. */
async function remainingReturnableQuantityMilli(
  tx: Tx,
  companyId: string,
  field: "sourceInvoiceLineId" | "sourceBillLineId",
  lineId: string,
  originalQuantityMilli: number,
): Promise<number> {
  const where =
    field === "sourceInvoiceLineId"
      ? { sourceInvoiceLineId: lineId, creditNote: { companyId, status: { not: "VOID" } } }
      : { sourceBillLineId: lineId, creditNote: { companyId, status: { not: "VOID" } } };
  const priorReturns = await tx.creditNoteLine.findMany({
    where,
    select: { quantityMilli: true },
  });
  const alreadyReturned = priorReturns.reduce((s, l) => s + l.quantityMilli, 0);
  return originalQuantityMilli - alreadyReturned;
}

/** Distribute `targetTaxCents` across `components` in the same proportion the
 * component's own full (unsuppressed) share would be, residue on the last
 * component. When the source line was never suppressed, `targetTaxCents`
 * already equals the full total and this is a no-op. */
function scaleComponentsToTarget(components: ComponentTax[], targetTaxCents: number): ComponentTax[] {
  if (components.length === 0) return [];
  const fullTotal = components.reduce((s, c) => s + c.taxCents, 0);
  if (fullTotal === 0) return components.map((c) => ({ ...c, taxCents: 0 }));
  if (fullTotal === targetTaxCents) return components;
  let allocated = 0;
  return components.map((c, i) => {
    if (i === components.length - 1) return { ...c, taxCents: targetTaxCents - allocated };
    const cents = Math.round((c.taxCents * targetTaxCents) / fullTotal);
    allocated += cents;
    return { ...c, taxCents: cents };
  });
}

function netByAccountFromReturnLines(lines: { accountId: string; taxCodeId: string | null; netCents: number }[]) {
  const map = new Map<string, { accountId: string; taxCodeId: string | null; netCents: number }>();
  for (const l of lines) {
    const key = `${l.accountId}|${l.taxCodeId ?? ""}`;
    const existing = map.get(key);
    if (existing) existing.netCents += l.netCents;
    else map.set(key, { accountId: l.accountId, taxCodeId: l.taxCodeId, netCents: l.netCents });
  }
  return [...map.values()];
}

interface SourceLineForReturn {
  id: string;
  itemId: string | null;
  accountId: string;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  discountMode: string;
  discountPercentMicro: number;
  discountAmountCents: number;
  netCents: number;
  taxCents: number;
  taxCodeId: string | null;
  projectId: string | null;
}

async function buildReturnLine(
  tx: Tx,
  companyId: string,
  source: { id: string; issueDate: Date; taxInclusive: boolean; sourceType: "INVOICE" | "BILL" },
  sourceLine: SourceLineForReturn,
  taxCodes: Map<string, TaxCodeSpec>,
  returnQuantityMilli: number,
  lineageField: "sourceInvoiceLineId" | "sourceBillLineId",
) {
  if (returnQuantityMilli <= 0) throw new Error("Return quantity must be greater than zero.");
  const remaining = await remainingReturnableQuantityMilli(
    tx,
    companyId,
    lineageField,
    sourceLine.id,
    sourceLine.quantityMilli,
  );
  if (returnQuantityMilli > remaining) {
    throw new Error(
      `Only ${remaining / 1000} unit(s) of "${sourceLine.description}" remain returnable.`,
    );
  }

  const netCents = prorateCents(sourceLine.netCents, returnQuantityMilli, sourceLine.quantityMilli);
  const taxCents = prorateCents(sourceLine.taxCents, returnQuantityMilli, sourceLine.quantityMilli);
  const discountAmountCents = prorateCents(
    sourceLine.discountAmountCents,
    returnQuantityMilli,
    sourceLine.quantityMilli,
  );

  const taxCode = sourceLine.taxCodeId ? taxCodes.get(sourceLine.taxCodeId) : null;
  const fullCalc = taxCode ? calculateTax(taxCode, netCents, source.taxInclusive, source.issueDate) : null;
  const taxComponents = scaleComponentsToTarget(fullCalc?.components ?? [], taxCents);

  let unitCostCents: number | null = null;
  let cogsAccountId: string | null = null;
  const trackedItem = sourceLine.itemId
    ? await tx.serviceItem.findFirst({
        where: { id: sourceLine.itemId, companyId, trackInventory: true },
        select: { id: true, expenseAccountId: true },
      })
    : null;
  if (trackedItem) {
    cogsAccountId = trackedItem.expenseAccountId;
    const movement = await tx.inventoryMovement.findFirst({
      where: {
        companyId,
        sourceType: source.sourceType,
        sourceId: source.id,
        sourceLineId: sourceLine.id,
        type: source.sourceType === "INVOICE" ? "SALE" : "PURCHASE",
      },
      select: { unitCostCents: true },
    });
    unitCostCents = movement?.unitCostCents ?? 0;
  }

  return {
    itemId: sourceLine.itemId,
    accountId: sourceLine.accountId,
    description: sourceLine.description,
    quantityMilli: returnQuantityMilli,
    unitPriceCents: sourceLine.unitPriceCents,
    discountMode: sourceLine.discountMode,
    discountPercentMicro: sourceLine.discountPercentMicro,
    discountAmountCents,
    netCents,
    taxCodeId: sourceLine.taxCodeId,
    taxCents,
    totalCents: netCents + taxCents,
    taxComponents,
    jurisdiction: taxCode?.jurisdiction ?? "CA",
    sourceLineId: sourceLine.id,
    unitCostCents,
    cogsAccountId,
    projectId: sourceLine.projectId,
  };
}

export interface CreditNoteReturnLineInput {
  invoiceLineId: string;
  quantityMilli: number;
}

export interface CreditNoteFromInvoiceInput {
  companyId: string;
  invoiceId: string;
  issueDate: Date | string;
  reason?: string;
  memo?: string;
  returns: CreditNoteReturnLineInput[];
  userId?: string | null;
}

/**
 * A customer credit note that returns specific quantities from specific
 * lines of a posted invoice — any status, including PAID (issue 10). Source
 * linkage is kept strictly separate from financial credit allocation: this
 * never applies the resulting credit to the invoice or any other document.
 */
export async function createCustomerCreditNoteFromInvoice(input: CreditNoteFromInvoiceInput) {
  if (input.returns.length === 0) throw new Error("Select at least one line to return.");
  return db.$transaction(async (tx) => {
    const issueDate = toUtcDay(input.issueDate);
    const invoice = await tx.invoice.findFirst({
      where: { id: input.invoiceId, companyId: input.companyId },
      include: { lines: true, customer: true },
    });
    if (!invoice) throw new Error("Invoice not found in this company.");
    if (!invoice.journalEntryId) throw new Error(`Invoice ${invoice.number} has not been posted yet.`);
    if (invoice.status === "VOID") throw new Error(`Invoice ${invoice.number} is void.`);

    const company = await tx.company.findUniqueOrThrow({
      where: { id: input.companyId },
      select: { creditNoteFooter: true },
    });

    const invoiceLineById = new Map(invoice.lines.map((l) => [l.id, l]));
    const taxCodes = await loadTaxCodes(tx, input.companyId, invoice.lines.map((l) => l.taxCodeId));

    const returnLines = [];
    for (const r of input.returns) {
      const invoiceLine = invoiceLineById.get(r.invoiceLineId);
      if (!invoiceLine) throw new Error("That invoice line does not belong to this invoice.");
      returnLines.push(
        await buildReturnLine(
          tx,
          input.companyId,
          { id: invoice.id, issueDate: invoice.issueDate, taxInclusive: invoice.taxInclusive, sourceType: "INVOICE" },
          invoiceLine,
          taxCodes,
          r.quantityMilli,
          "sourceInvoiceLineId",
        ),
      );
    }

    const subtotalCents = returnLines.reduce((s, l) => s + l.netCents, 0);
    const taxCents = returnLines.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;
    const taxByComponent = new Map<string, ComponentTax>();
    for (const l of returnLines) {
      for (const c of l.taxComponents) {
        const existing = taxByComponent.get(c.componentId);
        if (existing) {
          existing.taxCents += c.taxCents;
          existing.taxableCents += c.taxableCents;
        } else {
          taxByComponent.set(c.componentId, { ...c });
        }
      }
    }

    const number = await nextNumber(tx, input.companyId, "credit");
    const creditNote = await tx.creditNote.create({
      data: {
        companyId: input.companyId,
        type: "CUSTOMER",
        customerId: invoice.customerId,
        sourceInvoiceId: invoice.id,
        number,
        issueDate,
        status: "OPEN",
        reason: input.reason,
        memo: input.memo,
        taxInclusive: invoice.taxInclusive,
        footerText: company.creditNoteFooter ?? null,
        subtotalCents,
        taxCents,
        totalCents,
        balanceCents: totalCents,
        lines: {
          create: returnLines.map((l, i) => ({
            lineNo: i + 1,
            itemId: l.itemId,
            accountId: l.accountId,
            description: l.description,
            quantityMilli: l.quantityMilli,
            unitPriceCents: l.unitPriceCents,
            discountMode: l.discountMode,
            discountPercentMicro: l.discountPercentMicro,
            discountAmountCents: l.discountAmountCents,
            netCents: l.netCents,
            taxCodeId: l.taxCodeId,
            taxCents: l.taxCents,
            totalCents: l.totalCents,
            sourceInvoiceLineId: l.sourceLineId,
            unitCostCents: l.unitCostCents,
          })),
        },
      },
      include: { lines: true },
    });

    // Tracked items: restocking (issue 10) also reverses the original sale's
    // COGS posting — Dr Inventory Asset / Cr COGS, the mirror image of what
    // postInvoiceInTx debited. Missing this would leave the stock
    // quantity/value correct on the item but permanently out of reconciliation
    // against the Inventory Asset control account.
    const cogsByAccount = new Map<string, number>();
    let totalRestockCents = 0;
    for (const l of returnLines) {
      if (l.unitCostCents === null) continue;
      const restockCents = Math.round((l.quantityMilli * l.unitCostCents) / 1000);
      totalRestockCents += restockCents;
      const key = l.cogsAccountId; // resolved to the system COGS account below if null
      cogsByAccount.set(key ?? "__system_cogs__", (cogsByAccount.get(key ?? "__system_cogs__") ?? 0) + restockCents);
    }

    const ar = await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE);
    const inventoryAsset = totalRestockCents > 0
      ? await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.INVENTORY_ASSET)
      : null;
    const systemCogs = totalRestockCents > 0
      ? await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.COST_OF_GOODS_SOLD)
      : null;

    const journalLines = [
      ...netByAccountFromReturnLines(returnLines).map((entry) => ({
        accountId: entry.accountId,
        debitCents: entry.netCents,
        description: `Credit ${number}`,
        customerId: invoice.customerId,
        taxCodeId: entry.taxCodeId,
      })),
      ...[...taxByComponent.values()]
        .filter((c) => c.taxCents !== 0 && c.liabilityAccountId)
        .map((c) => ({
          accountId: c.liabilityAccountId!,
          debitCents: c.taxCents,
          description: `${c.name} reversal on ${number}`,
          customerId: invoice.customerId,
        })),
      ...(inventoryAsset && totalRestockCents !== 0
        ? [{ accountId: inventoryAsset.id, debitCents: totalRestockCents, description: `Stock returned — ${number}`, customerId: invoice.customerId }]
        : []),
      ...[...cogsByAccount.entries()]
        .filter(([, cents]) => cents !== 0)
        .map(([key, cents]) => ({
          accountId: key === "__system_cogs__" ? systemCogs!.id : key,
          creditCents: cents,
          description: `Cost of goods sold reversal — ${number}`,
          customerId: invoice.customerId,
        })),
      {
        accountId: ar.id,
        creditCents: totalCents,
        description: `${invoice.customer.name} — ${number}`,
        customerId: invoice.customerId,
      },
    ];

    const entry = await postJournal(tx, {
      companyId: input.companyId,
      date: issueDate,
      memo: `Credit note ${number} — ${invoice.customer.name}`,
      sourceType: "CREDIT_NOTE",
      sourceId: creditNote.id,
      sourceNumber: number,
      createdById: input.userId,
      lines: journalLines,
    });

    // Tracked items: restock at the ORIGINAL sale's cost, not today's average.
    for (const cnLine of creditNote.lines) {
      if (cnLine.unitCostCents === null || !cnLine.itemId) continue;
      await receiveStock(tx, {
        companyId: input.companyId,
        itemId: cnLine.itemId,
        date: issueDate,
        quantityMilli: cnLine.quantityMilli,
        totalCostCents: Math.round((cnLine.quantityMilli * cnLine.unitCostCents) / 1000),
        type: "SALE_RETURN",
        sourceType: "CREDIT_NOTE",
        sourceId: creditNote.id,
        sourceLineId: cnLine.id,
        sourceNumber: number,
        journalEntryId: entry.id,
        userId: input.userId,
      });
    }

    for (const l of returnLines) {
      if (!l.taxCodeId || l.taxComponents.length === 0) continue;
      await recordTaxEntries(tx, {
        companyId: input.companyId,
        date: issueDate,
        direction: "SALE",
        sourceType: "CREDIT_NOTE",
        sourceId: creditNote.id,
        sourceNumber: number,
        taxCodeId: l.taxCodeId,
        jurisdiction: l.jurisdiction,
        partyName: invoice.customer.name,
        journalEntryId: entry.id,
        components: l.taxComponents,
        negate: true,
      });
    }

    return tx.creditNote.update({
      where: { id: creditNote.id },
      data: { journalEntryId: entry.id, postedAt: new Date() },
      include: { lines: true },
    });
  });
}

export interface PurchaseReturnLineInput {
  billLineId: string;
  quantityMilli: number;
}

export interface PurchaseReturnFromBillInput {
  companyId: string;
  billId: string;
  issueDate: Date | string;
  reason?: string;
  memo?: string;
  returns: PurchaseReturnLineInput[];
  userId?: string | null;
}

/**
 * A vendor credit note that returns specific quantities from specific lines
 * of a posted bill (issue 4). A tracked line's inventory reversal happens at
 * the ORIGINAL RECEIPT cost; any difference from what the vendor actually
 * credits on that line is posted explicitly to Cost of Goods Sold rather
 * than folded into the average — see returnToVendor in
 * src/server/inventory/costing.ts.
 */
export async function createPurchaseReturnFromBill(input: PurchaseReturnFromBillInput) {
  if (input.returns.length === 0) throw new Error("Select at least one line to return.");
  return db.$transaction(async (tx) => {
    const issueDate = toUtcDay(input.issueDate);
    const bill = await tx.bill.findFirst({
      where: { id: input.billId, companyId: input.companyId },
      include: { lines: true, vendor: true },
    });
    if (!bill) throw new Error("Bill not found in this company.");
    if (!bill.journalEntryId) throw new Error(`Bill ${bill.number} has not been posted yet.`);
    if (bill.status === "VOID") throw new Error(`Bill ${bill.number} is void.`);

    const billLineById = new Map(bill.lines.map((l) => [l.id, l]));
    const taxCodes = await loadTaxCodes(tx, input.companyId, bill.lines.map((l) => l.taxCodeId));

    const returnLines = [];
    for (const r of input.returns) {
      const billLine = billLineById.get(r.billLineId);
      if (!billLine) throw new Error("That bill line does not belong to this bill.");
      returnLines.push(
        await buildReturnLine(
          tx,
          input.companyId,
          { id: bill.id, issueDate: bill.issueDate, taxInclusive: bill.taxInclusive, sourceType: "BILL" },
          // BillLine has no discountMode/discountAmountCents (issue 6 is
          // scoped to invoices/quotes only) — treat every bill line as an
          // unmodified PERCENT-mode line for reversal purposes.
          { ...billLine, discountMode: "PERCENT", discountAmountCents: 0 },
          taxCodes,
          r.quantityMilli,
          "sourceBillLineId",
        ),
      );
    }

    // A tracked line's reversal value is the ORIGINAL RECEIPT cost, which can
    // legitimately differ from this line's own prorated net+tax (what the
    // vendor is actually crediting, e.g. price changed since receipt). The
    // gap is posted explicitly to COGS instead of distorting the average.
    let inventoryReversalCents = 0;
    let cogsVarianceCents = 0;
    const regularExpenseByAccount = new Map<string, number>();
    const recoverableByAccount = new Map<string, number>();
    for (const l of returnLines) {
      for (const c of l.taxComponents) {
        if (c.taxCents !== 0 && c.isRecoverable && c.recoverableAccountId) {
          recoverableByAccount.set(
            c.recoverableAccountId,
            (recoverableByAccount.get(c.recoverableAccountId) ?? 0) + c.taxCents,
          );
        }
      }
      const nonRecoverableTax = l.taxComponents
        .filter((c) => c.taxCents !== 0 && !c.isRecoverable)
        .reduce((s, c) => s + c.taxCents, 0);

      if (l.unitCostCents !== null) {
        const reversalCents = Math.round((l.quantityMilli * l.unitCostCents) / 1000);
        inventoryReversalCents += reversalCents;
        cogsVarianceCents += l.netCents + nonRecoverableTax - reversalCents;
      } else {
        regularExpenseByAccount.set(
          l.accountId,
          (regularExpenseByAccount.get(l.accountId) ?? 0) + l.netCents + nonRecoverableTax,
        );
      }
    }

    const subtotalCents = returnLines.reduce((s, l) => s + l.netCents, 0);
    const taxCents = returnLines.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotalCents + taxCents;

    const number = await nextNumber(tx, input.companyId, "credit");
    const creditNote = await tx.creditNote.create({
      data: {
        companyId: input.companyId,
        type: "VENDOR",
        vendorId: bill.vendorId,
        sourceBillId: bill.id,
        number,
        issueDate,
        status: "OPEN",
        reason: input.reason,
        memo: input.memo,
        taxInclusive: bill.taxInclusive,
        subtotalCents,
        taxCents,
        totalCents,
        balanceCents: totalCents,
        lines: {
          create: returnLines.map((l, i) => ({
            lineNo: i + 1,
            itemId: l.itemId,
            accountId: l.accountId,
            description: l.description,
            quantityMilli: l.quantityMilli,
            unitPriceCents: l.unitPriceCents,
            netCents: l.netCents,
            taxCodeId: l.taxCodeId,
            taxCents: l.taxCents,
            totalCents: l.totalCents,
            sourceBillLineId: l.sourceLineId,
            unitCostCents: l.unitCostCents,
          })),
        },
      },
      include: { lines: true },
    });

    const ap = await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE);
    const inventoryAsset =
      inventoryReversalCents !== 0
        ? await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.INVENTORY_ASSET)
        : null;
    const cogs =
      cogsVarianceCents !== 0
        ? await getSystemAccount(tx, input.companyId, SYSTEM_ACCOUNTS.COST_OF_GOODS_SOLD)
        : null;

    const journalLines = [
      { accountId: ap.id, debitCents: totalCents, description: `${bill.vendor.name} — ${number}`, vendorId: bill.vendorId },
      ...[...regularExpenseByAccount.entries()].map(([accountId, cents]) => ({
        accountId,
        creditCents: cents,
        description: `Purchase return ${number}`,
        vendorId: bill.vendorId,
      })),
      ...(inventoryAsset && inventoryReversalCents !== 0
        ? [{ accountId: inventoryAsset.id, creditCents: inventoryReversalCents, description: `Stock returned — ${number}`, vendorId: bill.vendorId }]
        : []),
      ...(cogs && cogsVarianceCents !== 0
        ? cogsVarianceCents > 0
          ? [{ accountId: cogs.id, creditCents: cogsVarianceCents, description: `Return cost variance — ${number}`, vendorId: bill.vendorId }]
          : [{ accountId: cogs.id, debitCents: -cogsVarianceCents, description: `Return cost variance — ${number}`, vendorId: bill.vendorId }]
        : []),
      ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
        accountId,
        creditCents: cents,
        description: `ITC reversal — ${number}`,
        vendorId: bill.vendorId,
      })),
    ];

    const entry = await postJournal(tx, {
      companyId: input.companyId,
      date: issueDate,
      memo: `Purchase return ${number} — ${bill.vendor.name}`,
      sourceType: "CREDIT_NOTE",
      sourceId: creditNote.id,
      sourceNumber: number,
      createdById: input.userId,
      lines: journalLines,
    });

    for (const cnLine of creditNote.lines) {
      if (cnLine.unitCostCents === null || !cnLine.itemId) continue;
      await returnToVendor(tx, {
        companyId: input.companyId,
        itemId: cnLine.itemId,
        date: issueDate,
        quantityMilli: cnLine.quantityMilli,
        originalUnitCostCents: cnLine.unitCostCents,
        sourceType: "CREDIT_NOTE",
        sourceId: creditNote.id,
        sourceLineId: cnLine.id,
        sourceNumber: number,
        journalEntryId: entry.id,
        userId: input.userId,
      });
    }

    for (const l of returnLines) {
      if (!l.taxCodeId || l.taxComponents.length === 0) continue;
      await recordTaxEntries(tx, {
        companyId: input.companyId,
        date: issueDate,
        direction: "PURCHASE",
        sourceType: "CREDIT_NOTE",
        sourceId: creditNote.id,
        sourceNumber: number,
        taxCodeId: l.taxCodeId,
        jurisdiction: l.jurisdiction,
        partyName: bill.vendor.name,
        journalEntryId: entry.id,
        components: l.taxComponents,
        negate: true,
      });
    }

    return tx.creditNote.update({
      where: { id: creditNote.id },
      data: { journalEntryId: entry.id, postedAt: new Date() },
      include: { lines: true },
    });
  });
}

/**
 * Void a posted credit note (previously unimplemented — bills and invoices
 * both had a void path, credit notes did not). Reverses the journal, negates
 * the tax audit rows, and reverses any SALE_RETURN/PURCHASE_RETURN stock
 * movement it created. Refuses if any of its credit has already been applied
 * — unapply first, exactly like voidInvoice/voidBill refuse on cash applied.
 */
export async function voidCreditNote(creditNoteId: string, companyId: string, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const credit = await tx.creditNote.findFirst({ where: { id: creditNoteId, companyId } });
    if (!credit) throw new Error("Credit note not found in this company.");
    if (credit.status === "VOID") throw new Error("Credit note is already void.");
    if (credit.appliedCents !== 0) {
      throw new Error("Unapply this credit note before voiding it.");
    }

    if (credit.journalEntryId) {
      await reverseJournal(tx, credit.journalEntryId, {
        companyId,
        memo: `Void credit note ${credit.number}`,
        userId,
      });
      const original = await tx.taxEntry.findMany({
        where: { companyId, sourceType: "CREDIT_NOTE", sourceId: credit.id },
      });
      if (original.length) {
        await tx.taxEntry.createMany({
          data: original.map((t) => ({
            companyId,
            date: t.date,
            direction: t.direction,
            sourceType: "CREDIT_NOTE",
            sourceId: credit.id,
            sourceNumber: `${credit.number} (void)`,
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
        where: {
          companyId,
          sourceType: "CREDIT_NOTE",
          sourceId: credit.id,
          type: { in: ["SALE_RETURN", "PURCHASE_RETURN"] },
        },
      });
      for (const movement of stockMovements) await reverseStockMovement(tx, movement.id, userId);
    }

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: "VOID",
        entityType: "CreditNote",
        entityId: credit.id,
        summary: `Voided credit note ${credit.number}`,
      },
    });

    return tx.creditNote.update({
      where: { id: credit.id },
      data: { status: "VOID", balanceCents: 0 },
    });
  });
}
