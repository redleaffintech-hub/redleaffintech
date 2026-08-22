/**
 * Bank matching, categorisation rules and reconciliation (spec §11, §33).
 *
 * A bank line is never "just categorised" — every confirmation produces a real
 * posted journal entry, so the bank feed can never drift from the ledger.
 */

import { db, type Tx } from "@/lib/db";
import { toUtcDay } from "@/lib/dates";
import { postJournal, reverseJournal } from "@/server/accounting/ledger";
import { loadTaxCodes, recordTaxEntries } from "@/server/tax/engine";
import { computeDocument, splitPurchaseDebits } from "@/server/documents/lines";
import { recordPaymentInTx } from "@/server/documents/payments";

// ── Rules ───────────────────────────────────────────────────────────────────

export interface RuleSuggestion {
  ruleId: string;
  ruleName: string;
  accountId: string;
  taxCodeId: string | null;
  vendorId: string | null;
  autoConfirm: boolean;
}

export async function suggestRule(
  companyId: string,
  transaction: { bankAccountId: string; normalizedDesc: string; amountCents: number },
): Promise<RuleSuggestion | null> {
  const rules = await db.bankRule.findMany({
    where: {
      companyId,
      isActive: true,
      OR: [{ bankAccountId: null }, { bankAccountId: transaction.bankAccountId }],
    },
    orderBy: { priority: "asc" },
  });

  for (const rule of rules) {
    if (rule.direction === "IN" && transaction.amountCents < 0) continue;
    if (rule.direction === "OUT" && transaction.amountCents > 0) continue;
    const magnitude = Math.abs(transaction.amountCents);
    if (rule.amountMinCents != null && magnitude < rule.amountMinCents) continue;
    if (rule.amountMaxCents != null && magnitude > rule.amountMaxCents) continue;

    const needle = rule.matchValue.toUpperCase();
    const haystack = transaction.normalizedDesc;
    const hit =
      rule.matchType === "EQUALS" ? haystack === needle
      : rule.matchType === "STARTS_WITH" ? haystack.startsWith(needle)
      : rule.matchType === "REGEX" ? safeRegexTest(rule.matchValue, haystack)
      : haystack.includes(needle);

    if (hit) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        accountId: rule.setAccountId,
        taxCodeId: rule.setTaxCodeId,
        vendorId: rule.setVendorId,
        autoConfirm: rule.autoConfirm,
      };
    }
  }
  return null;
}

function safeRegexTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return false;
  }
}

// ── Document matching ───────────────────────────────────────────────────────

export interface DocumentMatch {
  kind: "INVOICE" | "BILL";
  id: string;
  number: string;
  partyName: string;
  date: Date;
  balanceCents: number;
  /** 0–100. Exact amount plus a close date is a near-certain match. */
  confidence: number;
  reason: string;
}

/**
 * Suggest open documents this bank line could settle. Scoring favours an exact
 * amount, then date proximity, then a name appearing in the bank description.
 */
export async function suggestMatches(
  companyId: string,
  transactionId: string,
): Promise<DocumentMatch[]> {
  const transaction = await db.bankTransaction.findFirst({
    where: { id: transactionId, companyId },
  });
  if (!transaction) return [];

  const magnitude = Math.abs(transaction.amountCents);
  const windowStart = new Date(transaction.date.getTime() - 45 * 86_400_000);
  const windowEnd = new Date(transaction.date.getTime() + 15 * 86_400_000);
  const matches: DocumentMatch[] = [];

  if (transaction.amountCents > 0) {
    const invoices = await db.invoice.findMany({
      where: {
        companyId,
        status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
        issueDate: { gte: windowStart, lte: windowEnd },
      },
      include: { customer: true },
      take: 40,
    });
    for (const invoice of invoices) {
      matches.push(scoreMatch("INVOICE", invoice.id, invoice.number, invoice.customer.name, invoice.issueDate, invoice.balanceCents, magnitude, transaction.date, transaction.normalizedDesc));
    }
  } else {
    const bills = await db.bill.findMany({
      where: {
        companyId,
        status: { in: ["OPEN", "PARTIALLY_PAID", "OVERDUE"] },
        balanceCents: { gt: 0 },
        issueDate: { gte: windowStart, lte: windowEnd },
      },
      include: { vendor: true },
      take: 40,
    });
    for (const bill of bills) {
      matches.push(scoreMatch("BILL", bill.id, bill.number, bill.vendor.name, bill.issueDate, bill.balanceCents, magnitude, transaction.date, transaction.normalizedDesc));
    }
  }

  return matches.filter((m) => m.confidence >= 30).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function scoreMatch(
  kind: "INVOICE" | "BILL",
  id: string,
  number: string,
  partyName: string,
  date: Date,
  balanceCents: number,
  magnitude: number,
  txDate: Date,
  txDesc: string,
): DocumentMatch {
  let confidence = 0;
  const reasons: string[] = [];

  if (balanceCents === magnitude) { confidence += 60; reasons.push("exact amount"); }
  else if (Math.abs(balanceCents - magnitude) <= 100) { confidence += 35; reasons.push("amount within $1"); }
  else if (Math.abs(balanceCents - magnitude) / Math.max(balanceCents, 1) < 0.02) { confidence += 15; reasons.push("amount within 2%"); }

  const dayGap = Math.abs(Math.round((txDate.getTime() - date.getTime()) / 86_400_000));
  if (dayGap <= 5) { confidence += 20; reasons.push("dates align"); }
  else if (dayGap <= 30) { confidence += 10; }

  const nameToken = partyName.toUpperCase().split(/\s+/)[0];
  if (nameToken.length >= 4 && txDesc.includes(nameToken)) { confidence += 20; reasons.push("payee name in description"); }
  if (txDesc.includes(number.toUpperCase())) { confidence += 25; reasons.push("document number in description"); }

  return {
    kind, id, number, partyName, date, balanceCents,
    confidence: Math.min(confidence, 100),
    reason: reasons.join(", ") || "partial amount",
  };
}

// ── Confirmation ────────────────────────────────────────────────────────────

/**
 * Categorise a bank line straight to a GL account. Outflows debit the expense
 * and split out any recoverable tax; inflows credit the income account.
 */
export async function categorizeTransaction(
  companyId: string,
  transactionId: string,
  input: { accountId: string; taxCodeId?: string | null; vendorId?: string | null; customerId?: string | null; memo?: string; userId?: string | null },
) {
  return db.$transaction(async (tx) => {
    const transaction = await tx.bankTransaction.findFirst({
      where: { id: transactionId, companyId },
      include: { bankAccount: true },
    });
    if (!transaction) throw new Error("Bank transaction not found in this company.");
    if (transaction.journalEntryId) throw new Error("This transaction is already posted.");

    const isOutflow = transaction.amountCents < 0;
    const magnitude = Math.abs(transaction.amountCents);
    const date = toUtcDay(transaction.date);

    const taxCodes = await loadTaxCodes(tx, companyId, [input.taxCodeId]);
    // Bank amounts are always the real cash figure, i.e. tax-inclusive.
    const doc = computeDocument(
      [{ accountId: input.accountId, description: input.memo ?? transaction.description, unitPriceCents: magnitude, taxCodeId: input.taxCodeId }],
      taxCodes,
      true,
      date,
    );

    let lines;
    if (isOutflow) {
      const { expenseByAccount, recoverableByAccount } = splitPurchaseDebits(doc.lines);
      lines = [
        ...[...expenseByAccount.entries()].map(([accountId, cents]) => ({
          accountId, debitCents: cents, description: transaction.description, vendorId: input.vendorId,
        })),
        ...[...recoverableByAccount.entries()].map(([accountId, cents]) => ({
          accountId, debitCents: cents, description: `Input tax credit — ${transaction.description}`, vendorId: input.vendorId,
        })),
        { accountId: transaction.bankAccount.accountId, creditCents: magnitude, description: transaction.description },
      ];
    } else {
      lines = [
        { accountId: transaction.bankAccount.accountId, debitCents: magnitude, description: transaction.description },
        ...doc.lines.map((l) => ({
          accountId: l.accountId, creditCents: l.netCents, description: transaction.description, customerId: input.customerId,
        })),
        ...doc.taxByComponent
          .filter((c) => c.taxCents !== 0 && c.liabilityAccountId)
          .map((c) => ({ accountId: c.liabilityAccountId!, creditCents: c.taxCents, description: `${c.name} on deposit` })),
      ];
    }

    const entry = await postJournal(tx, {
      companyId,
      date,
      memo: input.memo ?? transaction.description,
      sourceType: "BANK",
      sourceId: transaction.id,
      sourceNumber: transaction.reference,
      createdById: input.userId,
      lines,
    });

    for (const line of doc.lines) {
      if (!line.taxCodeId || line.taxComponents.length === 0) continue;
      await recordTaxEntries(tx, {
        companyId, date,
        direction: isOutflow ? "PURCHASE" : "SALE",
        sourceType: "BANK",
        sourceId: transaction.id,
        sourceNumber: transaction.reference,
        taxCodeId: line.taxCodeId,
        jurisdiction: line.jurisdiction,
        partyName: transaction.description,
        journalEntryId: entry.id,
        components: line.taxComponents,
      });
    }

    return tx.bankTransaction.update({
      where: { id: transactionId },
      data: {
        status: "CATEGORIZED",
        categoryAccountId: input.accountId,
        journalEntryId: entry.id,
        matchedType: "JOURNAL",
        matchedId: entry.id,
      },
    });
  });
}

/** Confirm a bank line against open invoices or bills, creating the payment. */
export async function matchTransactionToDocuments(
  companyId: string,
  transactionId: string,
  allocations: { invoiceId?: string; billId?: string; amountCents: number }[],
  userId?: string | null,
) {
  return db.$transaction(async (tx) => {
    const transaction = await tx.bankTransaction.findFirst({
      where: { id: transactionId, companyId },
      include: { bankAccount: true },
    });
    if (!transaction) throw new Error("Bank transaction not found in this company.");
    if (transaction.journalEntryId) throw new Error("This transaction is already posted.");

    const isReceipt = transaction.amountCents > 0;
    const magnitude = Math.abs(transaction.amountCents);

    let customerId: string | null = null;
    let vendorId: string | null = null;
    if (isReceipt && allocations[0]?.invoiceId) {
      const invoice = await tx.invoice.findFirst({ where: { id: allocations[0].invoiceId, companyId } });
      customerId = invoice?.customerId ?? null;
    } else if (!isReceipt && allocations[0]?.billId) {
      const bill = await tx.bill.findFirst({ where: { id: allocations[0].billId, companyId } });
      vendorId = bill?.vendorId ?? null;
    }

    const payment = await recordPaymentInTx(tx, {
      companyId,
      type: isReceipt ? "RECEIPT" : "PAYMENT",
      date: transaction.date,
      customerId,
      vendorId,
      bankAccountId: transaction.bankAccount.accountId,
      amountCents: magnitude,
      method: "EFT",
      reference: transaction.reference ?? undefined,
      memo: transaction.description,
      allocations,
      bankTransactionId: transaction.id,
      userId,
    });

    return tx.bankTransaction.update({
      where: { id: transactionId },
      data: {
        status: "MATCHED",
        matchedType: isReceipt ? "INVOICE_PAYMENT" : "BILL_PAYMENT",
        matchedId: payment.id,
        journalEntryId: payment.journalEntryId,
      },
    });
  });
}

/**
 * Transfer detection (§11): the mirror-image line in another account within a
 * few days is almost always the same movement of money, and posting it twice is
 * the single most common bookkeeping error a feed introduces.
 */
export async function detectTransfers(companyId: string) {
  const candidates = await db.bankTransaction.findMany({
    where: { companyId, status: "UNMATCHED" },
    include: { bankAccount: true },
    orderBy: { date: "asc" },
  });

  const pairs: { outId: string; inId: string; amountCents: number; date: Date }[] = [];
  const used = new Set<string>();

  for (const a of candidates) {
    if (used.has(a.id) || a.amountCents >= 0) continue;
    const match = candidates.find(
      (b) =>
        !used.has(b.id) &&
        b.id !== a.id &&
        b.bankAccountId !== a.bankAccountId &&
        b.amountCents === -a.amountCents &&
        Math.abs(b.date.getTime() - a.date.getTime()) <= 3 * 86_400_000,
    );
    if (match) {
      used.add(a.id);
      used.add(match.id);
      pairs.push({ outId: a.id, inId: match.id, amountCents: -a.amountCents, date: a.date });
    }
  }
  return pairs;
}

export async function confirmTransfer(
  companyId: string,
  outTransactionId: string,
  inTransactionId: string,
  userId?: string | null,
) {
  return db.$transaction(async (tx: Tx) => {
    const out = await tx.bankTransaction.findFirst({
      where: { id: outTransactionId, companyId }, include: { bankAccount: true },
    });
    const incoming = await tx.bankTransaction.findFirst({
      where: { id: inTransactionId, companyId }, include: { bankAccount: true },
    });
    if (!out || !incoming) throw new Error("Transfer transactions not found in this company.");

    const entry = await postJournal(tx, {
      companyId,
      date: toUtcDay(out.date),
      memo: `Transfer — ${out.bankAccount.name} to ${incoming.bankAccount.name}`,
      sourceType: "BANK",
      sourceId: out.id,
      createdById: userId,
      lines: [
        { accountId: incoming.bankAccount.accountId, debitCents: Math.abs(out.amountCents), description: "Transfer in" },
        { accountId: out.bankAccount.accountId, creditCents: Math.abs(out.amountCents), description: "Transfer out" },
      ],
    });

    await tx.bankTransaction.updateMany({
      where: { id: { in: [outTransactionId, inTransactionId] } },
      data: { status: "TRANSFER", matchedType: "TRANSFER", matchedId: entry.id },
    });
    await tx.bankTransaction.update({ where: { id: outTransactionId }, data: { journalEntryId: entry.id } });
    return entry;
  });
}

/** Undo a categorisation or match by reversing the journal it created. */
export async function unmatchTransaction(companyId: string, transactionId: string, userId?: string | null) {
  return db.$transaction(async (tx) => {
    const transaction = await tx.bankTransaction.findFirst({ where: { id: transactionId, companyId } });
    if (!transaction) throw new Error("Bank transaction not found in this company.");
    if (transaction.status === "RECONCILED") throw new Error("Undo the reconciliation before unmatching.");
    if (transaction.journalEntryId) {
      await reverseJournal(tx, transaction.journalEntryId, {
        companyId, memo: `Unmatched bank line — ${transaction.description}`, userId,
      });
    }
    return tx.bankTransaction.update({
      where: { id: transactionId },
      data: { status: "UNMATCHED", journalEntryId: null, matchedType: null, matchedId: null, categoryAccountId: null },
    });
  });
}
