"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ACCOUNT_SUBTYPES, subtypeLabel, type AccountType } from "@/lib/enums";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";

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

  const account = await db.account.findFirst({
    where: { id: accountId, companyId: company.id },
    select: { id: true, code: true, name: true, type: true, subtype: true },
  });
  if (!account) return { error: "That account does not belong to this company." };
  if (account.subtype === subtype) return { ok: true };

  const allowed = ACCOUNT_SUBTYPES[account.type as AccountType] ?? [];
  if (!allowed.includes(subtype)) {
    return {
      error: `${subtypeLabel(subtype)} is not a valid classification for a ${account.type.toLowerCase()} account.`,
    };
  }

  await db.account.update({ where: { id: account.id }, data: { subtype } });

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
