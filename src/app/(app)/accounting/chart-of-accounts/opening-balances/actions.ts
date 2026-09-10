"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toCents } from "@/lib/money";
import { toUtcDay } from "@/lib/dates";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { postOpeningBalances } from "@/server/accounting/journals";
import { parseOpeningBalancesCsv } from "@/server/accounting/opening-balances-import";
import { listAccounts } from "@/server/db/accounts";

async function accountsByCode(companyId: string) {
  const accounts = (await listAccounts(companyId)).filter((a) => a.isActive);
  return new Map(accounts.map((a) => [a.code.toLowerCase(), { id: a.id, code: a.code }]));
}

export async function openingBalancesFormOptions() {
  const { company } = await requireCapability(CAPABILITIES.COA);
  const accounts = (await listAccounts(company.id))
    .filter((a) => a.isActive)
    .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }));
  return { accounts };
}

/** CSV import — see the "Download template" button for the expected columns. */
export async function importOpeningBalancesCsvAction(date: string, content: string) {
  const { company, user } = await requireCapability(CAPABILITIES.COA);

  const codeMap = await accountsByCode(company.id);
  const { balances, errors } = parseOpeningBalancesCsv(content, codeMap);
  if (balances.length === 0) {
    return { error: errors[0] ?? "No opening balances were found in that file.", errors };
  }

  try {
    const entry = await postOpeningBalances(
      company.id,
      toUtcDay(date),
      balances.map((b) => ({ accountId: b.accountId, debitCents: b.debitCents, creditCents: b.creditCents })),
      user.id,
    );

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "CREATE",
      entityType: "JournalEntry",
      entityId: entry.id,
      summary: `Opening balances imported for ${balances.length} account(s) via CSV`,
    });

    revalidatePath("/accounting/chart-of-accounts");
    revalidatePath("/accounting/general-ledger");
    revalidatePath("/");

    return { ok: true as const, imported: balances.length, errors, redirectTo: `/accounting/journals/${entry.id}` };
  } catch (error) {
    return { error: (error as Error).message, errors };
  }
}

const manualSchema = z.object({
  date: z.string(),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        debit: z.string().optional(),
        credit: z.string().optional(),
      }),
    )
    .min(1, "Add at least one account."),
});

/**
 * Manual opening-balance entry. Unlike a manual journal, this does not need to
 * balance on its own — `postOpeningBalances` absorbs any residual into Opening
 * Balance Equity, which is the standard way to bring in a mid-life migration
 * without every account's counterpart being re-entered by hand.
 */
export async function importOpeningBalancesManualAction(payload: string) {
  const { company, user } = await requireCapability(CAPABILITIES.COA);

  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { error: "Could not read the opening balances." };
  }

  const parsed = manualSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the opening balances." };

  const lines = parsed.data.lines
    .map((line) => ({
      accountId: line.accountId,
      debitCents: line.debit ? toCents(line.debit) : undefined,
      creditCents: line.credit ? toCents(line.credit) : undefined,
    }))
    .filter((line) => line.debitCents || line.creditCents);

  if (lines.length === 0) return { error: "Enter a debit or credit for at least one account." };

  try {
    const entry = await postOpeningBalances(company.id, toUtcDay(parsed.data.date), lines, user.id);

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "CREATE",
      entityType: "JournalEntry",
      entityId: entry.id,
      summary: `Opening balances entered manually for ${lines.length} account(s)`,
    });

    revalidatePath("/accounting/chart-of-accounts");
    revalidatePath("/accounting/general-ledger");
    revalidatePath("/");

    return { redirectTo: `/accounting/journals/${entry.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
