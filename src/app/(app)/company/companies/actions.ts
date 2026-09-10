"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeCurrency, DEFAULT_CURRENCY } from "@/lib/currency";
import { PROVINCES } from "@/lib/enums";
import { CAPABILITIES } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { verifyPassword } from "@/server/auth/password";
import { provisionAdditionalCompany } from "@/server/setup/provision";
import { deleteCompany, updateCompany } from "@/server/db/companies";
import { upsertMembership } from "@/server/db/company-users";
import { getUser } from "@/server/db/users";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { estimates as estimatesRepo } from "@/server/db/estimates";
import { creditNotes as creditNotesRepo } from "@/server/db/credit-notes";
import { bills as billsRepo } from "@/server/db/bills";
import { expenses as expensesRepo } from "@/server/db/expenses";
import { listEntries } from "@/server/db/journal-entries";
import { listPayments } from "@/server/db/payments";
import { listCustomers } from "@/server/db/customers";
import { listVendors } from "@/server/db/vendors";
import { listItems } from "@/server/db/items";
import { bankAccounts as bankAccountsRepo } from "@/server/db/banking";
import { attachments as attachmentsRepo } from "@/server/db/supporting";
import {
  attachCompanyToSubscription,
  companyFamily,
  companyLimit,
  subscriptionForCompany,
} from "@/server/companies/families";

/**
 * Self-service company management.
 *
 * Gated on CAPABILITIES.COMPANY_SETTINGS throughout, which is FULL for PRIMARY
 * and read-only for every other role — the same capability the profile page
 * already uses, so "authorized Primary users" needs no new permission concept.
 *
 * Every mutation re-resolves the target company's family from the ACTING
 * user's own active company rather than trusting a company id the browser
 * sent on its own — a Primary can only touch companies that already share
 * their subscription.
 *
 * The company the user is currently sitting in can never be archived or
 * deleted from this screen; they switch away first. That single rule is also
 * what guarantees a family can never be left with zero live companies through
 * this workflow, without a separate "is this the last one" race to get wrong.
 */

async function requireFamilyMember(actingCompanyId: string, targetCompanyId: string) {
  const subscription = await subscriptionForCompany(actingCompanyId);
  if (!subscription) throw new Error("No subscription is associated with this account.");
  const family = await companyFamily(subscription.id);
  const target = family.find((c) => c.id === targetCompanyId);
  if (!target) throw new Error("That company is not part of your subscription.");
  return { subscription, family, target };
}

// ── Create ───────────────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(120).optional(),
  province: z.string().trim().length(2),
  baseCurrency: z.string().trim().min(3).max(3),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  businessNumber: z.string().trim().max(30).optional(),
  gstNumber: z.string().trim().max(30).optional(),
  qstNumber: z.string().trim().max(30).optional(),
  pstNumber: z.string().trim().max(30).optional(),
  email: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  addressLine1: z.string().trim().max(120).optional(),
  city: z.string().trim().max(60).optional(),
  postalCode: z.string().trim().max(10).optional(),
  industry: z.string().trim().max(80).optional(),
});

export async function createCompanyAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the company details and try again." };
  }
  const input = parsed.data;

  if (!PROVINCES.some((p) => p.code === input.province.toUpperCase())) {
    return { error: "Choose a Canadian province or territory." };
  }
  const baseCurrency = normalizeCurrency(input.baseCurrency) ?? DEFAULT_CURRENCY;

  const subscription = await subscriptionForCompany(company.id);
  if (!subscription) return { error: "No subscription is associated with this account." };

  try {
    const limit = await companyLimit(subscription.id);
    if (limit.used >= limit.limit) {
      throw new Error(
        `You are using ${limit.used} of ${limit.limit} companies on the ${limit.planName ?? "current"} plan. ` +
          `Archive one you no longer need, or upgrade the plan to add another.`,
      );
    }

    const created = await provisionAdditionalCompany(undefined, {
      ...input,
      province: input.province.toUpperCase(),
      baseCurrency,
      country: "CA",
    });
    await attachCompanyToSubscription(subscription.id, created.id, user.id);
    await upsertMembership({
      companyId: created.id,
      userId: user.id,
      role: "PRIMARY",
      status: "ACTIVE",
      acceptedAt: new Date(),
    });

    await recordAudit({
      companyId: created.id,
      userId: user.id,
      action: "CREATE",
      entityType: "Company",
      entityId: created.id,
      summary: `Company "${created.name}" created under the same subscription as ${company.name}`,
    });

    revalidatePath("/company/companies");
    revalidatePath("/", "layout");
    return { ok: true as const, companyId: created.id };
  } catch (error) {
    // The transaction rolled back — no partial company, no orphaned setup.
    return { error: (error as Error).message };
  }
}

// ── Archive / restore / delete ──────────────────────────────────────────────

const removalSchema = z.object({
  companyId: z.string().min(1),
  confirmName: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  password: z.string().min(1),
});

async function verifyRecentAuth(userId: string, password: string): Promise<string | null> {
  const user = await getUser(userId);
  if (!user) return "That password is incorrect.";
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? null : "That password is incorrect.";
}

export async function archiveCompanyAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const parsed = removalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the confirmation details and try again." };
  const input = parsed.data;

  if (input.companyId === company.id) {
    return { error: "You cannot archive the company you are currently in. Switch to another company first." };
  }

  try {
    const { target } = await requireFamilyMember(company.id, input.companyId);
    if (target.archivedAt) return { error: `${target.name} is already archived.` };
    if (target.name !== input.confirmName) {
      return { error: "The typed name does not match. Type the company name exactly to confirm." };
    }
    const authError = await verifyRecentAuth(user.id, input.password);
    if (authError) return { error: authError };

    await updateCompany(input.companyId, {
      archivedAt: new Date(),
      archivedById: user.id,
      archiveReason: input.reason,
    });

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "Company",
      entityId: input.companyId,
      summary: `Company "${target.name}" archived. Reason: ${input.reason}`,
    });

    revalidatePath("/company/companies");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const restoreSchema = z.object({
  companyId: z.string().min(1),
  confirmName: z.string().trim().min(1),
});

export async function restoreCompanyAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const parsed = restoreSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the confirmation details and try again." };
  const input = parsed.data;

  try {
    const { subscription, target } = await requireFamilyMember(company.id, input.companyId);
    if (!target.archivedAt) return { error: `${target.name} is not archived.` };
    if (target.name !== input.confirmName) {
      return { error: "The typed name does not match. Type the company name exactly to confirm." };
    }

    const limit = await companyLimit(subscription.id);
    if (limit.used >= limit.limit) {
      throw new Error(
        `Restoring "${target.name}" would use ${limit.used + 1} of ${limit.limit} companies on the ` +
          `${limit.planName ?? "current"} plan. Archive another company first, or upgrade the plan.`,
      );
    }
    await updateCompany(input.companyId, {
      archivedAt: null,
      archivedById: null,
      archiveReason: null,
    });

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "Company",
      entityId: input.companyId,
      summary: `Company "${target.name}" restored from archive`,
    });

    revalidatePath("/company/companies");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function deleteCompanyAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const parsed = removalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Check the confirmation details and try again." };
  const input = parsed.data;

  if (input.companyId === company.id) {
    return { error: "You cannot delete the company you are currently in. Switch to another company first." };
  }

  try {
    const { target } = await requireFamilyMember(company.id, input.companyId);
    if (target.name !== input.confirmName) {
      return { error: "The typed name does not match. Type the company name exactly to confirm." };
    }
    const authError = await verifyRecentAuth(user.id, input.password);
    if (authError) return { error: authError };

    // Re-verified immediately before deleting, so nothing posted between the
    // page load and this submission can slip through. Any count here makes this
    // company real business history rather than an empty shell.
    const cid = input.companyId;
    const [
      journalEntries, invoices, estimates, creditNotes, bills, expenses,
      payments, customers, vendors, banks, items, attachmentRows,
    ] = await Promise.all([
      listEntries(cid),
      invoicesRepo.list(cid),
      estimatesRepo.list(cid),
      creditNotesRepo.list(cid),
      billsRepo.list(cid),
      expensesRepo.list(cid),
      listPayments(cid),
      listCustomers(cid),
      listVendors(cid),
      bankAccountsRepo.list(cid),
      listItems(cid),
      attachmentsRepo.list(cid),
    ]);
    const used =
      journalEntries.length + invoices.length + estimates.length + creditNotes.length +
      bills.length + expenses.length + payments.length + customers.length + vendors.length +
      banks.length + items.length + attachmentRows.length;
    if (used > 0) {
      throw new Error(
        `"${target.name}" has accounting or business records and cannot be permanently deleted. Archive it instead.`,
      );
    }

    // Nothing accounting-related exists — only empty setup scaffolding, which
    // Firestore leaves orphaned harmlessly when the company doc is removed.
    await deleteCompany(cid);

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "DELETE",
      entityType: "Company",
      entityId: input.companyId,
      summary: `Company "${target.name}" permanently deleted (no accounting history existed). Reason: ${input.reason}`,
    });

    revalidatePath("/company/companies");
    return { ok: true as const };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
