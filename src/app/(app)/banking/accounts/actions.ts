"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeCurrency } from "@/lib/currency";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { bankAccounts as bankAccountsRepo, bankReconciliations, listBankTransactions } from "@/server/db/banking";
import { getAccount } from "@/server/db/accounts";

const BANK_ACCOUNT_TYPES = ["BANK", "CREDIT_CARD", "CASH"] as const;

const editSchema = z.object({
  bankAccountId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  institution: z.string().trim().max(120).optional(),
  accountNumberMasked: z.string().trim().max(30).optional(),
  type: z.enum(BANK_ACCOUNT_TYPES),
  currency: z.string().trim().min(3).max(3),
  accountId: z.string().min(1),
  isActive: z.string().optional(),
});

/**
 * Edit a bank/card account.
 *
 * Name, institution, masked account number and active status are always
 * editable — purely descriptive, they affect nothing already posted. Currency,
 * type and the linked GL account are locked the moment ANY transaction or
 * reconciliation exists against this account: each of those three decides how
 * imported activity is interpreted and where it posts, so changing one after
 * the fact would silently reinterpret history rather than describe it
 * differently. A brand-new, still-empty account can have all three corrected
 * freely, which is what makes fixing a setup mistake possible without ever
 * making a historical reinterpretation possible.
 */
export async function updateBankAccountAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.BANKING);
  const parsed = editSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the account details and try again." };
  }
  const input = parsed.data;

  const existing = await bankAccountsRepo.get(company.id, input.bankAccountId);
  if (!existing) return { error: "That account does not belong to this company." };

  const [transactions, reconciliations] = await Promise.all([
    listBankTransactions(company.id, { bankAccountId: existing.id }),
    bankReconciliations.list(company.id, { where: [["bankAccountId", "==", existing.id]] }),
  ]);
  const locked = transactions.length > 0 || reconciliations.length > 0;

  if (locked) {
    if (input.type !== existing.type) {
      return { error: "This account has activity, so its type is locked. Descriptive fields can still be changed." };
    }
    if (input.currency.toUpperCase() !== existing.currency) {
      return { error: "This account has activity, so its currency is locked." };
    }
    if (input.accountId !== existing.accountId) {
      return { error: "This account has activity, so its linked GL account is locked." };
    }
  }

  const currency = normalizeCurrency(input.currency);
  if (!currency) return { error: `${input.currency.toUpperCase()} is not a valid ISO 4217 currency code.` };

  if (!locked) {
    // Only reachable for a still-empty account: verify the new GL account is a
    // real, company-owned account of a compatible type before switching to it.
    const glAccount = await getAccount(company.id, input.accountId);
    if (!glAccount) return { error: "Choose a GL account that belongs to this company." };
    if (input.type === "CREDIT_CARD" && glAccount.type !== "LIABILITY") {
      return { error: "A credit card account must link to a liability account." };
    }
    if (input.type !== "CREDIT_CARD" && glAccount.type !== "ASSET") {
      return { error: "A bank or cash account must link to an asset account." };
    }
  }

  await bankAccountsRepo.update(company.id, existing.id, {
    name: input.name,
    institution: input.institution || null,
    accountNumberMasked: input.accountNumberMasked || null,
    isActive: input.isActive === "on",
    ...(locked ? {} : { type: input.type, currency, accountId: input.accountId }),
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "BankAccount",
    entityId: existing.id,
    summary: locked
      ? `Bank account "${existing.name}" updated (type, currency and GL account locked — activity exists)`
      : `Bank account "${existing.name}" updated`,
  });

  revalidatePath("/banking/accounts");
  return { ok: true as const };
}
