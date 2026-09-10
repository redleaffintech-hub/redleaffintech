"use server";

import { revalidatePath } from "next/cache";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability } from "@/server/auth/context";
import { closeFiscalYear, closePeriod, reopenPeriod } from "@/server/accounting/journals-fs";

export async function closePeriodAction(periodId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.PERIOD_CLOSE);
  try {
    await closePeriod(company.id, periodId, user.id);
    revalidatePath("/accounting/periods");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function reopenPeriodAction(periodId: string, reason: string) {
  const { company, user } = await requireCapability(CAPABILITIES.PERIOD_CLOSE);
  if (!reason.trim()) return { error: "A reason is required to reopen a closed period." };
  try {
    await reopenPeriod(company.id, periodId, user.id, reason);
    revalidatePath("/accounting/periods");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function closeYearAction(fiscalYear: number) {
  const { company, user } = await requireCapability(CAPABILITIES.PERIOD_CLOSE);
  try {
    const result = await closeFiscalYear(company.id, fiscalYear, user.id);
    revalidatePath("/accounting/periods");
    revalidatePath("/");
    return { redirectTo: `/accounting/journals/${result.entry.id}` };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
