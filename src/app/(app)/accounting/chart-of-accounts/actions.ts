"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ACCOUNT_SUBTYPES, subtypeLabel, type AccountType } from "@/lib/enums";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import {
  createAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from "@/server/db/accounts";
import { countLinesForAccount } from "@/server/db/journal-entries";
import { db, companyRef } from "@/server/db/firestore";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { estimates as estimatesRepo } from "@/server/db/estimates";
import { creditNotes as creditNotesRepo } from "@/server/db/credit-notes";
import { bills as billsRepo } from "@/server/db/bills";
import { expenses as expensesRepo } from "@/server/db/expenses";
import { budgets as budgetsRepo } from "@/server/db/supporting";
import { bankAccounts as bankAccountsRepo } from "@/server/db/banking";
import { listItems } from "@/server/db/items";
import { listTaxCodes } from "@/server/db/tax-codes";

const reclassifySchema = z.object({
  accountId: z.string().min(1),
  subtype: z.string().min(1).max(40),
});

/**
 * Change an account's subtype.
 *
 * This exists because the subtype is what the Profit & Loss statement uses to
 * decide where an account sits relative to EBITDA — an account classified
 * OPERATING_EXPENSE is above the line, INTEREST_EXPENSE is below it. A file
 * created before those classifications existed needs a way to say which of its
 * expenses are financing costs, and this is that way.
 *
 * It deliberately does NOT move an account between top-level types. Reclassing
 * an EXPENSE as a LIABILITY would silently restate every prior period's net
 * income and break the balance sheet against posted history; a mistake of that
 * shape belongs in a journal entry, not a dropdown.
 *
 * No balance is touched. This changes presentation only, which is why it is
 * allowed on accounts that already carry postings.
 */
export async function reclassifyAccountAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COA);
  const parsed = reclassifySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Pick an account and a classification." };
  const { accountId, subtype } = parsed.data;

  const account = await getAccount(company.id, accountId);
  if (!account) return { error: "That account does not belong to this company." };
  if (account.subtype === subtype) return { ok: true };

  const allowed = ACCOUNT_SUBTYPES[account.type as AccountType] ?? [];
  if (!allowed.includes(subtype)) {
    return {
      error: `${subtypeLabel(subtype)} is not a valid classification for a ${account.type.toLowerCase()} account.`,
    };
  }

  await updateAccount(company.id, account.id, { subtype });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Account",
    entityId: account.id,
    summary:
      `${account.code} ${account.name} reclassified from ${subtypeLabel(account.subtype)} ` +
      `to ${subtypeLabel(subtype)} (presentation only — no balances changed)`,
  });

  revalidatePath("/accounting/chart-of-accounts");
  revalidatePath("/reports/profit-and-loss");
  return { ok: true };
}

// ── Add / edit / remove ──────────────────────────────────────────────────────

const accountSchema = z.object({
  code: z.string().trim().min(1, "Give the account a code.").max(20),
  name: z.string().trim().min(1, "Give the account a name.").max(120),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  subtype: z.string().trim().min(1).max(40),
  description: z.string().trim().max(500).optional(),
  isActive: z.string().optional(),
});

async function validateAccountInput(
  companyId: string,
  input: z.infer<typeof accountSchema>,
  existingId?: string,
): Promise<{ error: string } | { ok: true }> {
  const allowed = ACCOUNT_SUBTYPES[input.type] ?? [];
  if (!allowed.includes(input.subtype)) {
    return { error: `${subtypeLabel(input.subtype)} is not a valid classification for a ${input.type.toLowerCase()} account.` };
  }
  const clash = (await listAccounts(companyId)).find(
    (a) => a.code === input.code && a.id !== existingId,
  );
  if (clash) return { error: `Code ${input.code} is already used by "${clash.name}".` };
  return { ok: true };
}

/**
 * Add an account to the chart.
 *
 * A code that clashes within the company is rejected outright rather than
 * silently disambiguated — a duplicate code is exactly the kind of mistake a
 * reconciliation later depends on not having been made.
 */
export async function createAccountAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COA);
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the account details and try again." };
  const input = parsed.data;

  const validation = await validateAccountInput(company.id, input);
  if ("error" in validation) return validation;

  const account = await createAccount({
    companyId: company.id,
    code: input.code,
    name: input.name,
    type: input.type,
    subtype: input.subtype,
    description: input.description || null,
    isActive: input.isActive === "on",
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "CREATE",
    entityType: "Account",
    entityId: account.id,
    summary: `Account ${account.code} — ${account.name} added to the chart`,
  });

  revalidatePath("/accounting/chart-of-accounts");
  return { ok: true as const };
}

/**
 * Edit an account.
 *
 * A system/control account (`isSystem`) is protected from anything the posting
 * engine relies on: it can never change type, subtype or code, and it cannot
 * be deactivated, because the engine looks these up by `systemKey` and a
 * moved or disabled control account is a broken posting engine, not an edited
 * one. Its name and description are safe to change and remain editable.
 */
export async function updateAccountAction(accountId: string, formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COA);
  const existing = await getAccount(company.id, accountId);
  if (!existing) return { error: "That account does not belong to this company." };

  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the account details and try again." };
  const input = parsed.data;

  if (existing.isSystem) {
    if (input.code !== existing.code || input.type !== existing.type || input.subtype !== existing.subtype) {
      return { error: `${existing.name} is a system account — its code, type and classification cannot change.` };
    }
    if (input.isActive !== "on") {
      return { error: `${existing.name} is a system account and cannot be deactivated.` };
    }
  }

  const validation = await validateAccountInput(company.id, input, accountId);
  if ("error" in validation) return validation;

  await updateAccount(company.id, accountId, {
    code: input.code,
    name: input.name,
    type: input.type,
    subtype: input.subtype,
    description: input.description || null,
    isActive: input.isActive === "on",
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Account",
    entityId: accountId,
    summary: `Account ${existing.code} — ${existing.name} updated`,
  });

  revalidatePath("/accounting/chart-of-accounts");
  return { ok: true as const };
}

/** How many rows, across every place an account can be posted to or defaulted from, reference it. */
async function accountReferenceCount(companyId: string, accountId: string): Promise<number> {
  const embeddedLineHit = (docs: { lines?: { accountId: string }[] }[]) =>
    docs.reduce((n, d) => n + (d.lines ?? []).filter((l) => l.accountId === accountId).length, 0);

  const [
    journalLines,
    invoiceDocs,
    estimateDocs,
    creditNoteDocs,
    billDocs,
    expenseDocs,
    budgetDocs,
    banks,
    items,
    taxCodes,
    accounts,
  ] = await Promise.all([
    countLinesForAccount(companyId, accountId),
    invoicesRepo.list(companyId),
    estimatesRepo.list(companyId),
    creditNotesRepo.list(companyId),
    billsRepo.list(companyId),
    expensesRepo.list(companyId),
    budgetsRepo.list(companyId),
    bankAccountsRepo.list(companyId),
    listItems(companyId),
    listTaxCodes(companyId),
    listAccounts(companyId),
  ]);

  const catalogueDefaults = items.filter(
    (i) => i.incomeAccountId === accountId || i.expenseAccountId === accountId,
  ).length;
  const taxComponents = taxCodes.reduce(
    (n, c) =>
      n +
      (c.components ?? []).filter(
        (comp) => comp.liabilityAccountId === accountId || comp.recoverableAccountId === accountId,
      ).length,
    0,
  );
  const childAccounts = accounts.filter((a) => a.parentId === accountId).length;

  return (
    journalLines +
    embeddedLineHit(invoiceDocs) +
    embeddedLineHit(estimateDocs) +
    embeddedLineHit(creditNoteDocs) +
    embeddedLineHit(billDocs) +
    embeddedLineHit(expenseDocs) +
    embeddedLineHit(budgetDocs) +
    banks.filter((b) => b.accountId === accountId).length +
    catalogueDefaults +
    taxComponents +
    childAccounts
  );
}

export async function setAccountActiveAction(accountId: string, isActive: boolean) {
  const { company, user } = await requireCapability(CAPABILITIES.COA);
  const account = await getAccount(company.id, accountId);
  if (!account) return { error: "That account does not belong to this company." };
  if (account.isSystem && !isActive) return { error: `${account.name} is a system account and cannot be deactivated.` };

  await updateAccount(company.id, accountId, { isActive });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Account",
    entityId: accountId,
    summary: `Account ${account.code} — ${account.name} ${isActive ? "reactivated" : "deactivated"}`,
  });

  revalidatePath("/accounting/chart-of-accounts");
  return { ok: true as const };
}

/**
 * Permanently remove an account. Only reachable when it is completely
 * unreferenced — no journal line, no document line, no budget line, no bank
 * account, no catalogue default, no tax component and no child account points
 * at it. Anything referenced is deactivated instead: historical reports read
 * an inactive account's balance exactly as they always did, so its history
 * stays intact and correct.
 */
export async function deleteAccountAction(accountId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.COA);
  const account = await getAccount(company.id, accountId);
  if (!account) return { error: "That account does not belong to this company." };
  if (account.isSystem) return { error: `${account.name} is a system account and cannot be deleted.` };

  const used = await accountReferenceCount(company.id, accountId);
  if (used > 0) {
    return {
      error: `${account.code} — ${account.name} is referenced by ${used} record${used === 1 ? "" : "s"} and cannot be deleted. Deactivate it instead.`,
    };
  }

  // Re-checked inside the transaction, immediately before deleting, so nothing
  // posted between the page rendering and this click can slip through.
  try {
    await db.runTransaction(async (tx) => {
      const stillUsed = await accountReferenceCount(company.id, accountId);
      if (stillUsed > 0) throw new Error(`${account.name} was just used by another record. Deactivate it instead.`);
      tx.delete(companyRef(company.id).collection("accounts").doc(accountId));
      tx.delete(companyRef(company.id).collection("accountCodes").doc(account.code));
    });
  } catch (error) {
    return { error: (error as Error).message };
  }

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "DELETE",
    entityType: "Account",
    entityId: accountId,
    summary: `Account ${account.code} — ${account.name} deleted (never referenced)`,
  });

  revalidatePath("/accounting/chart-of-accounts");
  return { ok: true as const };
}
