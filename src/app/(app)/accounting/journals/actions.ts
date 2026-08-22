"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { toCents } from "@/lib/money";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability, requireCompany } from "@/server/auth/context";
import { postManualJournal } from "@/server/accounting/journals";
import { reverseJournal } from "@/server/accounting/ledger";

const schema = z.object({
  date: z.string(),
  memo: z.string().min(1, "A memo is required so the entry is self-explanatory."),
  isAdjusting: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        debit: z.string().optional(),
        credit: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .min(2, "A journal entry needs at least two lines."),
});

export async function postJournalAction(payload: string) {
  const { company, user, role } = await requireCapability(CAPABILITIES.JOURNALS);
  const parsed = schema.safeParse(JSON.parse(payload));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const entry = await postManualJournal({
      companyId: company.id,
      date: parsed.data.date,
      memo: parsed.data.memo,
      isAdjusting: parsed.data.isAdjusting,
      userId: user.id,
      // Only an external accountant may push an adjusting entry into a closed
      // period, and only when they have explicitly flagged it as adjusting.
      allowClosedPeriod: role === "ACCOUNTANT" && parsed.data.isAdjusting,
      lines: parsed.data.lines.map((line) => ({
        accountId: line.accountId,
        debitCents: line.debit ? toCents(line.debit) : undefined,
        creditCents: line.credit ? toCents(line.credit) : undefined,
        description: line.description,
      })),
    });

    revalidatePath("/accounting/journals");
    revalidatePath("/");
    return { redirectTo: `/accounting/journals/${entry.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function reverseJournalAction(entryId: string, reason: string) {
  const { company, user } = await requireCapability(CAPABILITIES.JOURNALS);
  try {
    const reversal = await db.$transaction((tx) =>
      reverseJournal(tx, entryId, { companyId: company.id, memo: reason || undefined, userId: user.id }),
    );
    revalidatePath(`/accounting/journals/${entryId}`);
    revalidatePath("/accounting/journals");
    return { redirectTo: `/accounting/journals/${reversal.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function journalFormOptions() {
  const { company } = await requireCompany();
  const accounts = await db.account.findMany({
    where: { companyId: company.id, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
  return { accounts };
}
