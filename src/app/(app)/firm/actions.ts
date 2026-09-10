"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CAPABILITIES, requirePermission } from "@/lib/permissions";
import { switchCompany } from "@/server/auth/context";
import { closePeriod } from "@/server/accounting/journals-fs";
import { requireFirmAccess } from "@/server/firm/portfolio";

/**
 * Jump into a client file. The active company moves with the accountant, so the
 * screen they land on is scoped to that client like any other request — the
 * firm workspace never reads one company's data through another's context.
 */
export async function openClientAction(companyId: string, href: string) {
  const { clients } = await requireFirmAccess();
  if (!clients.some((client) => client.id === companyId)) {
    throw new Error("That company is not on your client list.");
  }
  // Only same-origin app paths; never a caller-supplied absolute URL.
  const destination = href.startsWith("/") && !href.startsWith("//") ? href : "/";

  await switchCompany(companyId);
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function firmClosePeriodAction(companyId: string, periodId: string) {
  const { clients, user } = await requireFirmAccess();
  if (!clients.some((client) => client.id === companyId)) {
    return { error: "That company is not on your client list." };
  }
  // The engagement role is ACCOUNTANT for every company on this list.
  requirePermission("ACCOUNTANT", CAPABILITIES.PERIOD_CLOSE);

  try {
    await closePeriod(companyId, periodId, user.id);
    revalidatePath("/firm/close");
    revalidatePath("/firm");
    return { ok: true };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
