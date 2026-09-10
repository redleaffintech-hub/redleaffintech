import "server-only";

/**
 * Sales invoices (§8, §33) — Firestore implementation.
 *
 * Posting rule
 *   Dr  Accounts Receivable            invoice total
 *     Cr  Revenue account(s)             line net, per account
 *     Cr  GST/HST (or PST/QST) Payable   tax, per component
 *   (+ Dr COGS / Cr Inventory Asset for tracked items sold)
 *
 * DEVIATION FROM THE PRISMA ENGINE: a Firestore transaction cannot read after it
 * has written, so the "create a draft and post it" and "edit a posted invoice"
 * flows run as a short sequence of single-purpose transactions rather than one.
 * A draft that then fails to post is a recoverable state, and edit = void +
 * rewrite + repost was already three logical steps. Each transaction on its own
 * is atomic and leaves the books consistent.
 */

import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { addDays, toUtcDay } from "@/lib/dates";
import { recordAudit } from "@/server/db/audit-logs";
import { bumpSequenceTx, runTransaction } from "@/server/db/companies";
import { getCustomerTx } from "@/server/db/customers";
import { invoices } from "@/server/db/invoices";
import { getTrackedItemsTx } from "@/server/db/items";
import { linkMovementsToEntryTx } from "@/server/db/inventory-movements";
import { listAllocationsForInvoice } from "@/server/db/payment-allocations";
import type { Tx } from "@/server/db/firestore";
import type { DocumentLine, Invoice } from "@/server/db/types";
import {
  commitPosting,
  getSystemAccount,
  planPosting,
  reverseJournal,
} from "@/server/accounting/ledger-fs";
import {
  loadTaxCodesTx,
  findTaxPeriodTx,
  recordTaxEntriesTx,
} from "@/server/tax/engine-fs";
import {
  commitConsumeStock,
  planConsumeStock,
  planReverseMovement,
  commitReverseMovement,
  type ConsumePlan,
} from "@/server/inventory/costing-fs";
import { listTaxEntriesForSourceTx } from "@/server/db/tax-entries";
import { listMovementsForSourceTx } from "@/server/db/inventory-movements";
import { createTaxEntriesTx } from "@/server/db/tax-entries";
import { computeDocument, netByAccount, type RawLine } from "./lines";

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
  post?: boolean;
  billTo?: DocumentAddressInput | null;
  shipTo?: DocumentAddressInput | null;
}

interface AddressCustomer {
  name: string;
  country: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToProvince: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
}

function blankAddress(a: DocumentAddressInput | null | undefined) {
  if (!a) return true;
  return !a.line1 && !a.line2 && !a.city && !a.province && !a.postalCode;
}

function documentAddressColumns(
  customer: AddressCustomer,
  input: Pick<InvoiceInput, "billTo" | "shipTo">,
) {
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
  return {
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
  };
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
    projectId: l.projectId ?? null,
  }));
}

// ── Create draft ────────────────────────────────────────────────────────────

export async function createInvoice(input: InvoiceInput): Promise<Invoice> {
  const draft = await runTransaction(async (tx) => {
    const issueDate = toUtcDay(input.issueDate);
    const customer = await getCustomerTx(tx, input.companyId, input.customerId);
    if (!customer) throw new Error("Customer not found in this company.");
    const dueDate = input.dueDate
      ? toUtcDay(input.dueDate)
      : addDays(issueDate, customer.paymentTermsDays);
    const taxCodes = await loadTaxCodesTx(
      tx,
      input.companyId,
      input.lines.map((l) => l.taxCodeId),
    );
    const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);
    const number = input.number ?? (await bumpSequenceTx(tx, input.companyId, "invoice"));

    return invoices.createTx(tx, {
      companyId: input.companyId,
      customerId: input.customerId,
      number,
      issueDate,
      dueDate,
      status: "DRAFT",
      memo: input.memo ?? null,
      terms: input.terms ?? null,
      poNumber: input.poNumber ?? null,
      currency: "CAD",
      projectId: input.projectId ?? null,
      taxInclusive: input.taxInclusive ?? false,
      ...documentAddressColumns(customer, input),
      subtotalCents: doc.subtotalCents,
      discountCents: doc.discountCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      amountPaidCents: 0,
      balanceCents: doc.totalCents,
      writtenOffCents: 0,
      journalEntryId: null,
      estimateId: null,
      recurringId: null,
      createdById: input.userId ?? null,
      postedAt: null,
      sentAt: null,
      voidedAt: null,
      lines: toDocumentLines(doc),
    } as Partial<Invoice> & { companyId: string });
  });

  if (input.post) return postInvoice(draft.id, input.companyId, input.userId);
  return draft;
}

// ── Post ────────────────────────────────────────────────────────────────────

export async function postInvoice(
  invoiceId: string,
  companyId: string,
  userId?: string | null,
): Promise<Invoice> {
  return runTransaction(async (tx) => {
    const invoice = await invoices.getTx(tx, companyId, invoiceId);
    if (!invoice) throw new Error("Invoice not found in this company.");
    if (invoice.journalEntryId) throw new Error(`Invoice ${invoice.number} is already posted.`);
    if (invoice.status === "VOID") throw new Error(`Invoice ${invoice.number} is void.`);
    if (invoice.lines.length === 0) throw new Error("An invoice needs at least one line.");

    const customer = await getCustomerTx(tx, companyId, invoice.customerId);
    if (!customer) throw new Error("Customer not found in this company.");

    // ── Read phase ──────────────────────────────────────────────────────────
    const taxCodes = await loadTaxCodesTx(
      tx,
      companyId,
      invoice.lines.map((l) => l.taxCodeId),
    );
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

    const itemIds = doc.lines.map((l) => l.itemId).filter((id): id is string => Boolean(id));
    const trackedItems = await getTrackedItemsTx(tx, companyId, itemIds);
    const consumePlans: { line: (typeof doc.lines)[number]; plan: ConsumePlan; cogsAccountId: string }[] = [];
    let cogsLines: {
      accountId: string;
      debitCents?: number;
      creditCents?: number;
      description: string;
      customerId: string;
    }[] = [];

    if (trackedItems.size > 0) {
      const inventoryAsset = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.INVENTORY_ASSET);
      const systemCogs = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.COST_OF_GOODS_SOLD);
      const cogsByAccount = new Map<string, number>();
      let totalCogsCents = 0;
      for (const line of doc.lines) {
        const item = line.itemId ? trackedItems.get(line.itemId) : undefined;
        if (!item) continue;
        const plan = await planConsumeStock(tx, companyId, item.id, line.quantityMilli);
        const cogsAccountId = item.expenseAccountId ?? systemCogs.id;
        consumePlans.push({ line, plan, cogsAccountId });
        cogsByAccount.set(cogsAccountId, (cogsByAccount.get(cogsAccountId) ?? 0) + plan.totalCostCents);
        totalCogsCents += plan.totalCostCents;
      }
      if (totalCogsCents !== 0) {
        cogsLines = [
          ...[...cogsByAccount.entries()].map(([accountId, cents]) => ({
            accountId,
            debitCents: cents,
            description: `Cost of goods sold — ${invoice.number}`,
            customerId: invoice.customerId,
          })),
          {
            accountId: inventoryAsset.id,
            creditCents: totalCogsCents,
            description: `Stock sold — ${invoice.number}`,
            customerId: invoice.customerId,
          },
        ];
      }
    }

    const taxPeriod = await findTaxPeriodTx(tx, companyId, invoice.issueDate);

    const journalLines = [
      {
        accountId: ar.id,
        debitCents: doc.totalCents,
        description: `${customer.name} — ${invoice.number}`,
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

    const plan = await planPosting(tx, {
      companyId,
      date: invoice.issueDate,
      memo: `Invoice ${invoice.number} — ${customer.name}`,
      sourceType: "INVOICE",
      sourceId: invoice.id,
      sourceNumber: invoice.number,
      createdById: userId,
      lines: journalLines,
    });

    // ── Write phase ─────────────────────────────────────────────────────────
    const movementIds: string[] = [];
    for (const { plan: cp } of consumePlans) {
      const movement = commitConsumeStock(tx, companyId, cp, {
        date: invoice.issueDate,
        sourceType: "INVOICE",
        sourceId: invoice.id,
        sourceNumber: invoice.number,
        userId,
      });
      movementIds.push(movement.id);
    }

    const entry = commitPosting(tx, plan);
    if (movementIds.length > 0) linkMovementsToEntryTx(tx, companyId, movementIds, entry.id);

    for (const line of doc.lines) {
      if (!line.taxCodeId || line.taxComponents.length === 0) continue;
      recordTaxEntriesTx(tx, {
        companyId,
        date: invoice.issueDate,
        direction: "SALE",
        sourceType: "INVOICE",
        sourceId: invoice.id,
        sourceNumber: invoice.number,
        taxCodeId: line.taxCodeId,
        jurisdiction: line.jurisdiction,
        partyName: customer.name,
        journalEntryId: entry.id,
        taxPeriodId: taxPeriod?.id ?? null,
        components: line.taxComponents,
      });
    }

    invoices.updateTx(tx, companyId, invoice.id, {
      status: "SENT",
      journalEntryId: entry.id,
      postedAt: new Date(),
      subtotalCents: doc.subtotalCents,
      discountCents: doc.discountCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      balanceCents: doc.totalCents - invoice.amountPaidCents,
    });

    return { ...invoice, status: "SENT", journalEntryId: entry.id, totalCents: doc.totalCents };
  });
}

// ── Void ────────────────────────────────────────────────────────────────────

export async function voidInvoice(
  invoiceId: string,
  companyId: string,
  userId?: string | null,
): Promise<Invoice> {
  const result = await runTransaction(async (tx) => {
    const invoice = await invoices.getTx(tx, companyId, invoiceId);
    if (!invoice) throw new Error("Invoice not found in this company.");
    if (invoice.status === "VOID") throw new Error("Invoice is already void.");
    if (invoice.amountPaidCents !== 0) {
      throw new Error("Unapply the payments on this invoice before voiding it.");
    }

    // ── Read phase ──────────────────────────────────────────────────────────
    const taxRows = invoice.journalEntryId
      ? await listTaxEntriesForSourceTx(tx, companyId, "INVOICE", invoice.id)
      : [];
    const movements = invoice.journalEntryId
      ? (await listMovementsForSourceTx(tx, companyId, "INVOICE", invoice.id)).filter(
          (m) => m.type === "SALE",
        )
      : [];
    const reversePlans = [];
    for (const m of movements) {
      reversePlans.push(await planReverseMovement(tx, companyId, m.id));
    }

    // ── Write phase ─────────────────────────────────────────────────────────
    if (invoice.journalEntryId) {
      await reverseJournal(tx, invoice.journalEntryId, {
        companyId,
        memo: `Void invoice ${invoice.number}`,
        userId,
      });
      if (taxRows.length) {
        createTaxEntriesTx(
          tx,
          taxRows.map((t) => ({
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
        );
      }
      for (const plan of reversePlans) commitReverseMovement(tx, plan, userId);
    }

    invoices.updateTx(tx, companyId, invoice.id, {
      status: "VOID",
      voidedAt: new Date(),
      balanceCents: 0,
    });
    return { ...invoice, status: "VOID" as const };
  });

  await recordAudit({
    companyId,
    userId: userId ?? null,
    action: "VOID",
    entityType: "Invoice",
    entityId: invoiceId,
    summary: `Voided invoice ${result.number}`,
  });
  return result;
}

// ── Status refresh (called by the payment flow) ─────────────────────────────

export async function refreshInvoiceStatusTx(
  tx: Tx,
  companyId: string,
  invoiceId: string,
  allocations: { amountCents: number; kind: string }[],
): Promise<void> {
  const invoice = await invoices.getTx(tx, companyId, invoiceId);
  if (!invoice || invoice.status === "VOID" || invoice.status === "DRAFT") return;

  const settled = allocations.reduce((s, a) => s + a.amountCents, 0);
  const cashPaid = allocations
    .filter((a) => a.kind === "PAYMENT")
    .reduce((s, a) => s + a.amountCents, 0);
  const balance = invoice.totalCents - settled;

  let status = invoice.status;
  if (balance <= 0) status = "PAID";
  else if (settled > 0) status = "PARTIALLY_PAID";
  else status = new Date() > invoice.dueDate ? "OVERDUE" : "SENT";

  invoices.updateTx(tx, companyId, invoiceId, {
    amountPaidCents: cashPaid,
    balanceCents: balance,
    status,
  });
}

export { listAllocationsForInvoice };
