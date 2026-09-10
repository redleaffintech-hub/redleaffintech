import "server-only";

/**
 * Bank matching + categorisation rules (§11, §33) — Firestore implementation.
 * `categorizeTransaction` / `unmatchTransaction` are in ./categorize-fs.
 *
 * DEVIATION: matching a bank line to open documents records the payment in its
 * own transaction (payments-fs), then flags the bank line in a second — a
 * Firestore transaction can't compose recordPayment's reads-then-writes with its
 * own writes. If the second step fails you have a payment and an unmatched bank
 * line, which is recoverable.
 */

import { toUtcDay } from "@/lib/dates";
import { runTransaction } from "@/server/db/companies";
import { bankAccounts, bankRules, bankTransactions, listActiveBankRules } from "@/server/db/banking";
import { getCustomer } from "@/server/db/customers";
import { getVendor } from "@/server/db/vendors";
import { invoices } from "@/server/db/invoices";
import { bills } from "@/server/db/bills";
import { commitPosting, planPosting } from "@/server/accounting/ledger";
import { recordPayment } from "@/server/documents/payments";
import { categorizeTransaction } from "./categorize";

// ── Rules ──────────────────────────────────────────────────────────────────

export interface RuleSuggestion {
  ruleId: string;
  ruleName: string;
  accountId: string;
  taxCodeId: string | null;
  vendorId: string | null;
  autoConfirm: boolean;
}

function safeRegexTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return false;
  }
}

export async function suggestRule(
  companyId: string,
  transaction: { bankAccountId: string; normalizedDesc: string; amountCents: number },
): Promise<RuleSuggestion | null> {
  const rules = (await listActiveBankRules(companyId)).filter(
    (r) => r.bankAccountId == null || r.bankAccountId === transaction.bankAccountId,
  );

  for (const rule of rules) {
    if (rule.direction === "IN" && transaction.amountCents < 0) continue;
    if (rule.direction === "OUT" && transaction.amountCents > 0) continue;
    const magnitude = Math.abs(transaction.amountCents);
    if (rule.amountMinCents != null && magnitude < rule.amountMinCents) continue;
    if (rule.amountMaxCents != null && magnitude > rule.amountMaxCents) continue;

    const needle = rule.matchValue.toUpperCase();
    const haystack = transaction.normalizedDesc;
    const hit =
      rule.matchType === "EQUALS"
        ? haystack === needle
        : rule.matchType === "STARTS_WITH"
          ? haystack.startsWith(needle)
          : rule.matchType === "REGEX"
            ? safeRegexTest(rule.matchValue, haystack)
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

/** Apply a matched rule: post the categorisation and bump the rule's counter. */
export async function applyRuleToTransaction(
  companyId: string,
  transactionId: string,
  suggestion: RuleSuggestion,
  userId?: string | null,
) {
  const result = await categorizeTransaction(companyId, transactionId, {
    accountId: suggestion.accountId,
    taxCodeId: suggestion.taxCodeId,
    vendorId: suggestion.vendorId,
    userId,
  });
  await bankTransactions.update(companyId, transactionId, { appliedRuleId: suggestion.ruleId });
  const rule = await bankRules.get(companyId, suggestion.ruleId);
  if (rule) {
    await bankRules.update(companyId, suggestion.ruleId, { timesApplied: rule.timesApplied + 1 });
  }
  return result;
}

// ── Document matching ──────────────────────────────────────────────────────

export interface DocumentMatch {
  kind: "INVOICE" | "BILL";
  id: string;
  number: string;
  partyName: string;
  date: Date;
  balanceCents: number;
  confidence: number;
  reason: string;
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
  if (balanceCents === magnitude) {
    confidence += 60;
    reasons.push("exact amount");
  } else if (Math.abs(balanceCents - magnitude) <= 100) {
    confidence += 35;
    reasons.push("amount within $1");
  } else if (Math.abs(balanceCents - magnitude) / Math.max(balanceCents, 1) < 0.02) {
    confidence += 15;
    reasons.push("amount within 2%");
  }
  const dayGap = Math.abs(Math.round((txDate.getTime() - date.getTime()) / 86_400_000));
  if (dayGap <= 5) {
    confidence += 20;
    reasons.push("dates align");
  } else if (dayGap <= 30) {
    confidence += 10;
  }
  const nameToken = partyName.toUpperCase().split(/\s+/)[0];
  if (nameToken.length >= 4 && txDesc.includes(nameToken)) {
    confidence += 20;
    reasons.push("payee name in description");
  }
  if (txDesc.includes(number.toUpperCase())) {
    confidence += 25;
    reasons.push("document number in description");
  }
  return {
    kind,
    id,
    number,
    partyName,
    date,
    balanceCents,
    confidence: Math.min(confidence, 100),
    reason: reasons.join(", ") || "partial amount",
  };
}

export async function suggestMatches(
  companyId: string,
  transactionId: string,
): Promise<DocumentMatch[]> {
  const transaction = await bankTransactions.get(companyId, transactionId);
  if (!transaction) return [];

  const magnitude = Math.abs(transaction.amountCents);
  const windowStart = new Date(transaction.date.getTime() - 45 * 86_400_000);
  const windowEnd = new Date(transaction.date.getTime() + 15 * 86_400_000);
  const matches: DocumentMatch[] = [];

  if (transaction.amountCents > 0) {
    const open = (
      await invoices.list(companyId, {
        where: [["status", "in", ["SENT", "PARTIALLY_PAID", "OVERDUE"]]],
      })
    ).filter(
      (i) => i.balanceCents > 0 && i.issueDate >= windowStart && i.issueDate <= windowEnd,
    );
    for (const invoice of open.slice(0, 40)) {
      const customer = await getCustomer(companyId, invoice.customerId);
      matches.push(
        scoreMatch(
          "INVOICE",
          invoice.id,
          invoice.number,
          customer?.name ?? "",
          invoice.issueDate,
          invoice.balanceCents,
          magnitude,
          transaction.date,
          transaction.normalizedDesc,
        ),
      );
    }
  } else {
    const open = (
      await bills.list(companyId, {
        where: [["status", "in", ["OPEN", "PARTIALLY_PAID", "OVERDUE"]]],
      })
    ).filter(
      (b) => b.balanceCents > 0 && b.issueDate >= windowStart && b.issueDate <= windowEnd,
    );
    for (const bill of open.slice(0, 40)) {
      const vendor = await getVendor(companyId, bill.vendorId);
      matches.push(
        scoreMatch(
          "BILL",
          bill.id,
          bill.number,
          vendor?.name ?? "",
          bill.issueDate,
          bill.balanceCents,
          magnitude,
          transaction.date,
          transaction.normalizedDesc,
        ),
      );
    }
  }

  return matches
    .filter((m) => m.confidence >= 30)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

export async function matchTransactionToDocuments(
  companyId: string,
  transactionId: string,
  allocations: { invoiceId?: string; billId?: string; amountCents: number }[],
  userId?: string | null,
) {
  const transaction = await bankTransactions.get(companyId, transactionId);
  if (!transaction) throw new Error("Bank transaction not found in this company.");
  if (transaction.journalEntryId) throw new Error("This transaction is already posted.");

  const bankAccount = await bankAccounts.get(companyId, transaction.bankAccountId);
  if (!bankAccount) throw new Error("The transaction's bank account no longer exists.");

  const isReceipt = transaction.amountCents > 0;
  const magnitude = Math.abs(transaction.amountCents);

  let customerId: string | null = null;
  let vendorId: string | null = null;
  if (isReceipt && allocations[0]?.invoiceId) {
    customerId = (await invoices.get(companyId, allocations[0].invoiceId))?.customerId ?? null;
  } else if (!isReceipt && allocations[0]?.billId) {
    vendorId = (await bills.get(companyId, allocations[0].billId))?.vendorId ?? null;
  }

  const payment = await recordPayment({
    companyId,
    type: isReceipt ? "RECEIPT" : "PAYMENT",
    date: transaction.date,
    customerId,
    vendorId,
    bankAccountId: bankAccount.accountId,
    amountCents: magnitude,
    method: "EFT",
    reference: transaction.reference ?? undefined,
    memo: transaction.description,
    allocations,
    bankTransactionId: transaction.id,
    userId,
  });

  await bankTransactions.update(companyId, transactionId, {
    status: "MATCHED",
    matchedType: isReceipt ? "INVOICE_PAYMENT" : "BILL_PAYMENT",
    matchedId: payment.id,
    journalEntryId: payment.journalEntryId,
  });
  return payment;
}

// ── Transfers ──────────────────────────────────────────────────────────────

export async function detectTransfers(companyId: string) {
  const candidates = (
    await bankTransactions.list(companyId, { where: [["status", "==", "UNMATCHED"]], orderBy: "date" })
  );
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
  return runTransaction(async (tx) => {
    const out = await bankTransactions.getTx(tx, companyId, outTransactionId);
    const incoming = await bankTransactions.getTx(tx, companyId, inTransactionId);
    if (!out || !incoming) throw new Error("Transfer transactions not found in this company.");
    const outAccount = await bankAccounts.getTx(tx, companyId, out.bankAccountId);
    const inAccount = await bankAccounts.getTx(tx, companyId, incoming.bankAccountId);
    if (!outAccount || !inAccount) throw new Error("A transfer account no longer exists.");

    const plan = await planPosting(tx, {
      companyId,
      date: toUtcDay(out.date),
      memo: `Transfer — ${outAccount.name} to ${inAccount.name}`,
      sourceType: "BANK",
      sourceId: out.id,
      createdById: userId,
      lines: [
        {
          accountId: inAccount.accountId,
          debitCents: Math.abs(out.amountCents),
          description: "Transfer in",
        },
        {
          accountId: outAccount.accountId,
          creditCents: Math.abs(out.amountCents),
          description: "Transfer out",
        },
      ],
    });
    const entry = commitPosting(tx, plan);

    bankTransactions.updateTx(tx, companyId, outTransactionId, {
      status: "TRANSFER",
      matchedType: "TRANSFER",
      matchedId: entry.id,
      journalEntryId: entry.id,
    });
    bankTransactions.updateTx(tx, companyId, inTransactionId, {
      status: "TRANSFER",
      matchedType: "TRANSFER",
      matchedId: entry.id,
    });
    return entry;
  });
}
