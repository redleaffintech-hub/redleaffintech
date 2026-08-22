"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability, requireCompany } from "@/server/auth/context";
import {
  categorizeTransaction, confirmTransfer, detectTransfers, matchTransactionToDocuments,
  suggestMatches, suggestRule, unmatchTransaction,
} from "@/server/banking/matching";
import { importTransactions, parseCsv, parseOfx } from "@/server/banking/import";
import { completeReconciliation, recalculate, setCleared, startReconciliation } from "@/server/banking/reconcile";

export async function categorizeAction(transactionId: string, accountId: string, taxCodeId: string | null, memo?: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BANKING);
  try {
    await categorizeTransaction(company.id, transactionId, { accountId, taxCodeId, memo, userId: user.id });
    revalidatePath("/banking");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function matchAction(transactionId: string, documentId: string, kind: "INVOICE" | "BILL", amountCents: number) {
  const { company, user } = await requireCapability(CAPABILITIES.BANKING);
  try {
    await matchTransactionToDocuments(
      company.id,
      transactionId,
      [kind === "INVOICE" ? { invoiceId: documentId, amountCents } : { billId: documentId, amountCents }],
      user.id,
    );
    revalidatePath("/banking");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function unmatchAction(transactionId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BANKING);
  try {
    await unmatchTransaction(company.id, transactionId, user.id);
    revalidatePath("/banking");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function excludeAction(transactionId: string) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  await db.bankTransaction.updateMany({
    where: { id: transactionId, companyId: company.id, journalEntryId: null },
    data: { status: "EXCLUDED" },
  });
  revalidatePath("/banking");
  return { ok: true };
}

export async function confirmTransfersAction() {
  const { company, user } = await requireCapability(CAPABILITIES.BANKING);
  const pairs = await detectTransfers(company.id);
  for (const pair of pairs) {
    await confirmTransfer(company.id, pair.outId, pair.inId, user.id);
  }
  revalidatePath("/banking");
  return { ok: true, count: pairs.length };
}

/** Suggestions for one transaction: matching documents plus any rule that fires. */
export async function suggestionsAction(transactionId: string) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  const transaction = await db.bankTransaction.findFirst({ where: { id: transactionId, companyId: company.id } });
  if (!transaction) return { matches: [], rule: null };

  const [matches, rule] = await Promise.all([
    suggestMatches(company.id, transactionId),
    suggestRule(company.id, {
      bankAccountId: transaction.bankAccountId,
      normalizedDesc: transaction.normalizedDesc,
      amountCents: transaction.amountCents,
    }),
  ]);

  return {
    matches: matches.map((m) => ({ ...m, date: m.date.toISOString() })),
    rule,
  };
}

export async function importAction(bankAccountId: string, fileName: string, content: string) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  const parsed = fileName.toLowerCase().endsWith(".ofx") || fileName.toLowerCase().endsWith(".qfx")
    ? parseOfx(content)
    : parseCsv(content);

  if (parsed.rows.length === 0) {
    return { error: parsed.errors[0] ?? "No transactions could be read from that file." };
  }

  try {
    const result = await importTransactions(company.id, bankAccountId, parsed.rows);
    revalidatePath("/banking");
    return {
      ok: true,
      imported: result.imported,
      duplicates: result.duplicates,
      warnings: parsed.errors.slice(0, 5),
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const ruleSchema = z.object({
  name: z.string().min(1),
  matchValue: z.string().min(2),
  matchType: z.string(),
  direction: z.string(),
  setAccountId: z.string().min(1),
  setTaxCodeId: z.string().optional(),
  autoConfirm: z.string().optional(),
});

export async function createRuleAction(formData: FormData) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the rule details and try again." };

  await db.bankRule.create({
    data: {
      companyId: company.id,
      name: parsed.data.name,
      matchValue: parsed.data.matchValue.toUpperCase(),
      matchType: parsed.data.matchType,
      direction: parsed.data.direction,
      setAccountId: parsed.data.setAccountId,
      setTaxCodeId: parsed.data.setTaxCodeId || null,
      autoConfirm: parsed.data.autoConfirm === "on",
    },
  });
  revalidatePath("/banking/rules");
  return { ok: true };
}

export async function deleteRuleAction(ruleId: string) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  await db.bankRule.deleteMany({ where: { id: ruleId, companyId: company.id } });
  revalidatePath("/banking/rules");
  return { ok: true };
}

// ── Reconciliation ──────────────────────────────────────────────────────────

export async function startReconciliationAction(formData: FormData) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  try {
    const reconciliation = await startReconciliation(company.id, {
      bankAccountId: String(formData.get("bankAccountId")),
      statementStartDate: String(formData.get("statementStartDate")),
      statementEndDate: String(formData.get("statementEndDate")),
      openingBalanceCents: toCents(String(formData.get("openingBalance") ?? "0")),
      closingBalanceCents: toCents(String(formData.get("closingBalance") ?? "0")),
    });
    revalidatePath("/banking/reconcile");
    return { ok: true, id: reconciliation.id };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function toggleClearedAction(reconciliationId: string, transactionId: string, cleared: boolean) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  try {
    const state = await setCleared(company.id, reconciliationId, [transactionId], cleared);
    revalidatePath("/banking/reconcile");
    return { ok: true, differenceCents: state.differenceCents };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function completeReconciliationAction(reconciliationId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.BANKING);
  try {
    await completeReconciliation(company.id, reconciliationId, user.id);
    revalidatePath("/banking/reconcile");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function bankingOptions() {
  const { company } = await requireCompany();
  const [accounts, taxCodes, bankAccounts] = await Promise.all([
    db.account.findMany({
      where: { companyId: company.id, isActive: true, type: { in: ["EXPENSE", "REVENUE", "ASSET", "LIABILITY", "EQUITY"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    db.taxCode.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.bankAccount.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, accountNumberMasked: true },
    }),
  ]);
  return { accounts, taxCodes, bankAccounts };
}
