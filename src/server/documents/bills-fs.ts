import "server-only";

/**
 * Vendor bills (§9) — Firestore implementation.
 *
 *   Dr  Expense / Asset account(s)   line net + any NON-recoverable tax
 *   Dr  GST/HST Recoverable (ITC)    recoverable tax
 *     Cr  Accounts Payable             bill total
 *
 * Same two-phase / multi-transaction shape as invoices-fs.ts (see its header).
 */

import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { addDays, toUtcDay } from "@/lib/dates";
import { recordAudit } from "@/server/db/audit-logs";
import { bumpSequenceTx, runTransaction } from "@/server/db/companies";
import { getVendorTx } from "@/server/db/vendors";
import { bills } from "@/server/db/bills";
import { getTrackedItemsTx } from "@/server/db/items";
import {
  createTaxEntriesTx,
  listTaxEntriesForSourceTx,
} from "@/server/db/tax-entries";
import {
  linkMovementsToEntryTx,
  listMovementsForSourceTx,
} from "@/server/db/inventory-movements";
import type { Tx } from "@/server/db/firestore";
import type { Bill, DocumentLine } from "@/server/db/types";
import {
  commitPosting,
  getSystemAccount,
  planPosting,
  reverseJournal,
} from "@/server/accounting/ledger-fs";
import { findTaxPeriodTx, loadTaxCodesTx, recordTaxEntriesTx } from "@/server/tax/engine-fs";
import {
  commitReceiveStock,
  commitReverseMovement,
  planReceiveStock,
  planReverseMovement,
} from "@/server/inventory/costing-fs";
import { computeDocument, splitPurchaseDebits, type RawLine } from "./lines";

export interface BillInput {
  companyId: string;
  vendorId: string;
  issueDate: Date | string;
  dueDate?: Date | string;
  number?: string;
  vendorInvoiceNo?: string;
  memo?: string;
  projectId?: string | null;
  taxInclusive?: boolean;
  requiresApproval?: boolean;
  lines: RawLine[];
  userId?: string | null;
  post?: boolean;
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
    isBillable: l.isBillable ?? false,
    customerId: l.customerId ?? null,
    projectId: l.projectId ?? null,
  }));
}

// ── Create draft ────────────────────────────────────────────────────────────

export async function createBill(input: BillInput): Promise<Bill> {
  const draft = await runTransaction(async (tx) => {
    const issueDate = toUtcDay(input.issueDate);
    const vendor = await getVendorTx(tx, input.companyId, input.vendorId);
    if (!vendor) throw new Error("Vendor not found in this company.");

    if (input.vendorInvoiceNo) {
      const dup = (
        await bills.list(input.companyId, {
          where: [
            ["vendorId", "==", input.vendorId],
            ["vendorInvoiceNo", "==", input.vendorInvoiceNo],
          ],
        })
      ).find((b) => b.status !== "VOID");
      if (dup) {
        throw new Error(
          `${vendor.name} invoice ${input.vendorInvoiceNo} is already recorded as ${dup.number}.`,
        );
      }
    }

    const dueDate = input.dueDate
      ? toUtcDay(input.dueDate)
      : addDays(issueDate, vendor.paymentTermsDays);
    const taxCodes = await loadTaxCodesTx(tx, input.companyId, input.lines.map((l) => l.taxCodeId));
    const doc = computeDocument(input.lines, taxCodes, input.taxInclusive ?? false, issueDate);
    const number = input.number ?? (await bumpSequenceTx(tx, input.companyId, "bill"));

    return bills.createTx(tx, {
      companyId: input.companyId,
      vendorId: input.vendorId,
      number,
      vendorInvoiceNo: input.vendorInvoiceNo ?? null,
      issueDate,
      dueDate,
      status: input.requiresApproval ? "AWAITING_APPROVAL" : "DRAFT",
      approvalStatus: input.requiresApproval ? "PENDING" : "NOT_REQUIRED",
      approvedById: null,
      approvedAt: null,
      memo: input.memo ?? null,
      projectId: input.projectId ?? null,
      taxInclusive: input.taxInclusive ?? false,
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      amountPaidCents: 0,
      balanceCents: doc.totalCents,
      journalEntryId: null,
      recurringId: null,
      createdById: input.userId ?? null,
      postedAt: null,
      voidedAt: null,
      lines: toDocumentLines(doc),
    } as Partial<Bill> & { companyId: string });
  });

  if (input.post) return postBill(draft.id, input.companyId, input.userId);
  return draft;
}

export async function approveBill(billId: string, companyId: string, userId: string): Promise<Bill> {
  await runTransaction(async (tx) => {
    const bill = await bills.getTx(tx, companyId, billId);
    if (!bill) throw new Error("Bill not found in this company.");
    if (bill.approvalStatus !== "PENDING") throw new Error("This bill is not awaiting approval.");
    bills.updateTx(tx, companyId, billId, {
      approvalStatus: "APPROVED",
      approvedById: userId,
      approvedAt: new Date(),
      status: "DRAFT",
    });
  });
  await recordAudit({
    companyId,
    userId,
    action: "UPDATE",
    entityType: "Bill",
    entityId: billId,
    summary: "Approved bill",
  });
  return postBill(billId, companyId, userId);
}

// ── Post ────────────────────────────────────────────────────────────────────

export async function postBill(
  billId: string,
  companyId: string,
  userId?: string | null,
): Promise<Bill> {
  return runTransaction(async (tx) => {
    const bill = await bills.getTx(tx, companyId, billId);
    if (!bill) throw new Error("Bill not found in this company.");
    if (bill.journalEntryId) throw new Error(`Bill ${bill.number} is already posted.`);
    if (bill.approvalStatus === "PENDING") throw new Error(`Bill ${bill.number} needs approval first.`);
    if (bill.lines.length === 0) throw new Error("A bill needs at least one line.");

    const vendor = await getVendorTx(tx, companyId, bill.vendorId);
    if (!vendor) throw new Error("Vendor not found in this company.");

    // ── Read phase ──────────────────────────────────────────────────────────
    const taxCodes = await loadTaxCodesTx(tx, companyId, bill.lines.map((l) => l.taxCodeId));
    const doc = computeDocument(
      bill.lines.map((l) => ({
        accountId: l.accountId,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unitPriceCents: l.unitPriceCents,
        discountPercentMicro: l.discountPercentMicro,
        taxCodeId: l.taxCodeId,
        itemId: l.itemId,
        customerId: l.customerId,
        projectId: l.projectId,
        isBillable: l.isBillable,
      })),
      taxCodes,
      bill.taxInclusive,
      bill.issueDate,
    );

    const itemIds = doc.lines.map((l) => l.itemId).filter((id): id is string => Boolean(id));
    const trackedItems = await getTrackedItemsTx(tx, companyId, itemIds);
    const trackedLines = doc.lines.filter((l) => l.itemId && trackedItems.has(l.itemId));
    const regularLines = doc.lines.filter((l) => !(l.itemId && trackedItems.has(l.itemId)));

    const ap = await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE);
    const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(regularLines);
    const trackedSplit = splitPurchaseDebits(trackedLines);
    const inventoryCostCents = [...trackedSplit.expenseByAccount.values()].reduce((s, v) => s + v, 0);
    for (const [accountId, cents] of trackedSplit.recoverableByAccount) {
      recoverableByAccount.set(accountId, (recoverableByAccount.get(accountId) ?? 0) + cents);
    }
    const inventoryAsset =
      inventoryCostCents > 0
        ? await getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.INVENTORY_ASSET)
        : null;

    const receivePlans = [];
    for (const line of trackedLines) {
      let lineCost = line.netCents;
      for (const c of line.taxComponents) {
        if (c.taxCents !== 0 && !c.isRecoverable) lineCost += c.taxCents;
      }
      receivePlans.push({
        line,
        plan: await planReceiveStock(tx, companyId, line.itemId!, line.quantityMilli, lineCost),
      });
    }

    const taxPeriod = await findTaxPeriodTx(tx, companyId, bill.issueDate);

    const plan = await planPosting(tx, {
      companyId,
      date: bill.issueDate,
      memo: `Bill ${bill.number} — ${vendor.name}`,
      sourceType: "BILL",
      sourceId: bill.id,
      sourceNumber: bill.number,
      createdById: userId,
      lines: [
        ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({
          accountId,
          debitCents: cents,
          description: bill.memo ?? `Bill ${bill.number}`,
          vendorId: bill.vendorId,
          projectId: bill.projectId,
        })),
        ...(inventoryAsset
          ? [
              {
                accountId: inventoryAsset.id,
                debitCents: inventoryCostCents,
                description: `Stock received — ${bill.number}`,
                vendorId: bill.vendorId,
              },
            ]
          : []),
        ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
          accountId,
          debitCents: cents,
          description: `Input tax credit — ${bill.number}`,
          vendorId: bill.vendorId,
        })),
        {
          accountId: ap.id,
          creditCents: doc.totalCents,
          description: `${vendor.name} — ${bill.number}`,
          vendorId: bill.vendorId,
        },
      ],
    });

    // ── Write phase ─────────────────────────────────────────────────────────
    const movementIds: string[] = [];
    for (const { plan: rp } of receivePlans) {
      const m = commitReceiveStock(tx, companyId, rp, {
        date: bill.issueDate,
        sourceType: "BILL",
        sourceId: bill.id,
        sourceNumber: bill.number,
        userId,
      });
      movementIds.push(m.id);
    }

    const entry = commitPosting(tx, plan);
    if (movementIds.length > 0) linkMovementsToEntryTx(tx, companyId, movementIds, entry.id);

    for (const line of doc.lines) {
      if (!line.taxCodeId || line.taxComponents.length === 0) continue;
      recordTaxEntriesTx(tx, {
        companyId,
        date: bill.issueDate,
        direction: "PURCHASE",
        sourceType: "BILL",
        sourceId: bill.id,
        sourceNumber: bill.number,
        taxCodeId: line.taxCodeId,
        jurisdiction: line.jurisdiction,
        partyName: vendor.name,
        journalEntryId: entry.id,
        taxPeriodId: taxPeriod?.id ?? null,
        components: line.taxComponents,
      });
    }

    bills.updateTx(tx, companyId, bill.id, {
      status: "OPEN",
      journalEntryId: entry.id,
      postedAt: new Date(),
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      totalCents: doc.totalCents,
      balanceCents: doc.totalCents - bill.amountPaidCents,
    });

    return { ...bill, status: "OPEN", journalEntryId: entry.id, totalCents: doc.totalCents };
  });
}

// ── Void ────────────────────────────────────────────────────────────────────

export async function voidBill(
  billId: string,
  companyId: string,
  userId?: string | null,
): Promise<Bill> {
  const result = await runTransaction(async (tx) => {
    const bill = await bills.getTx(tx, companyId, billId);
    if (!bill) throw new Error("Bill not found in this company.");
    if (bill.status === "VOID") throw new Error("Bill is already void.");
    if (bill.amountPaidCents !== 0) {
      throw new Error("Unapply the payments on this bill before voiding it.");
    }

    const taxRows = bill.journalEntryId
      ? await listTaxEntriesForSourceTx(tx, companyId, "BILL", bill.id)
      : [];
    const movements = bill.journalEntryId
      ? (await listMovementsForSourceTx(tx, companyId, "BILL", bill.id)).filter(
          (m) => m.type === "PURCHASE",
        )
      : [];
    const reversePlans = [];
    for (const m of movements) reversePlans.push(await planReverseMovement(tx, companyId, m.id));

    if (bill.journalEntryId) {
      await reverseJournal(tx, bill.journalEntryId, {
        companyId,
        memo: `Void bill ${bill.number}`,
        userId,
      });
      if (taxRows.length) {
        createTaxEntriesTx(
          tx,
          taxRows.map((t) => ({
            companyId,
            date: t.date,
            direction: t.direction,
            sourceType: "BILL",
            sourceId: bill.id,
            sourceNumber: `${bill.number} (void)`,
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

    bills.updateTx(tx, companyId, bill.id, {
      status: "VOID",
      voidedAt: new Date(),
      balanceCents: 0,
    });
    return { ...bill, status: "VOID" as const };
  });

  await recordAudit({
    companyId,
    userId: userId ?? null,
    action: "VOID",
    entityType: "Bill",
    entityId: billId,
    summary: `Voided bill ${result.number}`,
  });
  return result;
}

// ── Status refresh (called by the payment flow) ─────────────────────────────

export async function refreshBillStatusTx(
  tx: Tx,
  companyId: string,
  billId: string,
  allocations: { amountCents: number; kind: string }[],
): Promise<void> {
  const bill = await bills.getTx(tx, companyId, billId);
  if (!bill || bill.status === "VOID" || bill.status === "DRAFT") return;

  const settled = allocations.reduce((s, a) => s + a.amountCents, 0);
  const cashPaid = allocations
    .filter((a) => a.kind === "PAYMENT")
    .reduce((s, a) => s + a.amountCents, 0);
  const balance = bill.totalCents - settled;

  let status = bill.status;
  if (balance <= 0) status = "PAID";
  else if (settled > 0) status = "PARTIALLY_PAID";
  else status = new Date() > bill.dueDate ? "OVERDUE" : "OPEN";

  bills.updateTx(tx, companyId, billId, {
    amountPaidCents: cashPaid,
    balanceCents: balance,
    status,
  });
}
