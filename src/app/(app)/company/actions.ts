"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addDays, isoDate } from "@/lib/dates";
import { applyFiscalYearChange, planFiscalYearChange } from "@/server/accounting/fiscal-calendar-fs";
import { normalizeCurrency } from "@/lib/currency";
import { COMPANY_ROLES, PROVINCES } from "@/lib/enums";
import { CAPABILITIES } from "@/lib/permissions";
import { assignmentFromPlan, sellablePlanByCode } from "@/server/plans/catalogue";
import { hashPassword } from "@/server/auth/password";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { getCompany, updateCompany } from "@/server/db/companies";
import { listEntries } from "@/server/db/journal-entries";
import {
  deleteMembership,
  getMembership,
  listMembershipsForCompany,
  updateMembership,
  upsertMembership,
} from "@/server/db/company-users";
import { createUser, getUser, getUserByEmail } from "@/server/db/users";
import { getSubscriptionForCompany, subscriptions } from "@/server/db/platform";

/** Membership doc ids are `${companyId}__${userId}`; the UI passes the doc id. */
function userIdFromMembership(membershipId: string, companyId: string): string | null {
  const prefix = `${companyId}__`;
  return membershipId.startsWith(prefix) ? membershipId.slice(prefix.length) : null;
}

// ── Profile & preferences ───────────────────────────────────────────────────

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(120).optional(),
  businessNumber: z.string().trim().max(30).optional(),
  gstNumber: z.string().trim().max(30).optional(),
  qstNumber: z.string().trim().max(30).optional(),
  pstNumber: z.string().trim().max(30).optional(),
  baseCurrency: z.string().trim().min(3).max(3),
  /** Set by the form once the user has acknowledged a currency relabel. */
  confirmCurrencyChange: z.string().optional(),
  province: z.string().trim().length(2),
  addressLine1: z.string().trim().max(120).optional(),
  city: z.string().trim().max(60).optional(),
  postalCode: z.string().trim().max(10).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(120).optional(),
  website: z.string().trim().max(120).optional(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365),
  defaultTaxInclusive: z.string().optional(),
  invoiceFooter: z.string().trim().max(500).optional(),
});

export async function saveCompanyProfileAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the company details and try again." };
  }
  const input = parsed.data;

  if (!PROVINCES.some((province) => province.code === input.province.toUpperCase())) {
    return { error: "Choose a Canadian province or territory." };
  }
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
    return { error: "Enter a valid email address, or leave it blank." };
  }

  // Base currency is a LABEL, not a conversion. Amounts are stored as integer
  // cents with no currency attached, so changing this restates what every
  // historical figure claims to be denominated in without touching a single
  // number. That is legitimate for a file set up under the wrong currency and
  // corrected before use; it is not legitimate once real transactions exist.
  // Hence: validate the code, then require an explicit acknowledgement if
  // anything has been posted.
  const baseCurrency = normalizeCurrency(input.baseCurrency);
  if (!baseCurrency) {
    return { error: `${input.baseCurrency.toUpperCase()} is not a valid ISO 4217 currency code.` };
  }
  const currencyChanged = baseCurrency !== company.baseCurrency;
  if (currencyChanged) {
    const posted = (await listEntries(company.id)).length;
    if (posted > 0 && input.confirmCurrencyChange !== "on") {
      return {
        error:
          `Changing the base currency from ${company.baseCurrency} to ${baseCurrency} relabels ` +
          `${posted.toLocaleString("en-CA")} posted entries without converting any amounts. ` +
          `Tick the confirmation box to proceed.`,
        needsCurrencyConfirmation: true,
      };
    }
  }

  // The fiscal year start is NOT saved here. It defines every period boundary,
  // so it moves through `changeFiscalYearStartAction`, which plans the change,
  // creates the periods and records why — all in one transaction. Saving the
  // rest of the profile must never move it as a side effect.
  const fiscalYearStartChanged = input.fiscalYearStartMonth !== company.fiscalYearStartMonth;

  await updateCompany(company.id, {
    name: input.name,
    legalName: input.legalName || null,
    businessNumber: input.businessNumber || null,
    gstNumber: input.gstNumber || null,
    qstNumber: input.qstNumber || null,
    pstNumber: input.pstNumber || null,
    baseCurrency,
    province: input.province.toUpperCase(),
    addressLine1: input.addressLine1 || null,
    city: input.city || null,
    postalCode: input.postalCode || null,
    phone: input.phone || null,
    email: input.email || null,
    website: input.website || null,
    defaultPaymentTermsDays: input.defaultPaymentTermsDays,
    defaultTaxInclusive: input.defaultTaxInclusive === "on",
    invoiceFooter: input.invoiceFooter || null,
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Company",
    entityId: company.id,
    // A currency relabel changes what every historical figure claims to be
    // denominated in, so it is called out rather than hidden inside a generic
    // "profile updated".
    summary: currencyChanged
      ? `Company profile updated — base currency changed from ${company.baseCurrency} to ${baseCurrency} (no amounts converted)`
      : `Company profile updated`,
  });

  revalidatePath("/company");
  revalidatePath("/", "layout");
  return { ok: true, fiscalYearStartIgnored: fiscalYearStartChanged };
}

/**
 * Longest data URL the logo field accepts — keeps a Postgres text column and
 * every page that loads it (topbar, document letterheads) small.
 */
const MAX_LOGO_DATA_URL_LENGTH = 300_000;

/**
 * Set or clear the company logo. Split out from `saveCompanyProfileAction` so
 * it can be driven from the topbar's quick-change menu without round-tripping
 * every other profile field.
 */
export async function updateCompanyLogoAction(dataUrl: string | null) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);

  if (dataUrl && (!dataUrl.startsWith("data:image/") || dataUrl.length > MAX_LOGO_DATA_URL_LENGTH)) {
    return { error: "That doesn't look like a valid image." };
  }

  await updateCompany(company.id, { logoUrl: dataUrl });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Company",
    entityId: company.id,
    summary: dataUrl ? "Company logo updated" : "Company logo removed",
  });

  revalidatePath("/", "layout");
  return { ok: true as const };
}

// ── Fiscal calendar ─────────────────────────────────────────────────────────

const fiscalChangeSchema = z.object({
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  /** Calendar year the new basis begins in. Absent means "earliest safe". */
  effectiveYear: z.coerce.number().int().min(1900).max(2200).optional(),
  reason: z.string().trim().max(500).optional(),
  confirm: z.string().optional(),
});

/**
 * What a proposed fiscal-year change would do.
 *
 * Read-only, and scoped to the caller's own company — the company id is never
 * accepted from the browser. The form calls this to fill the confirmation
 * dialog before anything is written.
 */
export async function previewFiscalYearChangeAction(month: number, effectiveYear?: number) {
  const { company } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: "Choose a month between January and December." };
  }
  const plan = await planFiscalYearChange(company.id, month, effectiveYear);
  return {
    ok: true as const,
    plan: {
      currentStartMonth: plan.currentStartMonth,
      newStartMonth: plan.newStartMonth,
      postedEntries: plan.postedEntries,
      existingPeriods: plan.existingPeriods,
      closedOrLockedPeriods: plan.closedOrLockedPeriods,
      effectiveDate: isoDate(plan.effectiveDate),
      effectiveFiscalYear: plan.effectiveFiscalYear,
      immediate: plan.immediate,
      transition: plan.transition
        ? {
            start: isoDate(plan.transition.start),
            end: isoDate(plan.transition.end),
            months: plan.transition.months,
          }
        : null,
      firstNewYear: {
        fiscalYear: plan.firstNewYear.fiscalYear,
        start: isoDate(plan.firstNewYear.start),
        end: isoDate(plan.firstNewYear.end),
      },
      blockers: plan.blockers,
    },
  };
}

/**
 * Move the fiscal year start.
 *
 * Prospective by construction: existing periods keep their dates, posted
 * entries keep their periods, and closed or locked periods are never touched.
 * The company row, the new periods and the audit record are written in one
 * transaction, so a partial calendar cannot survive a failure.
 */
export async function changeFiscalYearStartAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const parsed = fiscalChangeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the fiscal year details and try again." };
  }
  const input = parsed.data;

  if (input.fiscalYearStartMonth === company.fiscalYearStartMonth) {
    return { error: "That is already the fiscal year start." };
  }
  if (input.confirm !== "on") {
    return { error: "Confirm the change before saving." };
  }

  const plan = await planFiscalYearChange(company.id, input.fiscalYearStartMonth, input.effectiveYear);
  if (plan.blockers.length > 0) return { error: plan.blockers[0] };

  // A reason is evidence, and it is only meaningful once there is history to
  // explain. A file with nothing posted is still being set up.
  if (plan.postedEntries > 0 && !input.reason) {
    return { error: "Give a reason for the change — it is written to the audit log." };
  }

  try {
    // Re-read just before applying: another change may have landed between the
    // preview and the save. `applyFiscalYearChange` does its own writes.
    const fresh = await getCompany(company.id);
    if (!fresh) throw new Error("Company not found.");
    if (fresh.fiscalYearStartMonth !== plan.currentStartMonth) {
      throw new Error("The fiscal year start changed while you were confirming. Reload and try again.");
    }
    const result = await applyFiscalYearChange(
      {
        companyId: company.id,
        userId: user.id,
        newStartMonth: input.fiscalYearStartMonth,
        effectiveYear: input.effectiveYear,
        reason: input.reason,
      },
      plan,
    );

    const monthName = (m: number) =>
      new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, m - 1, 1)));

    await recordAudit({
      companyId: company.id,
      userId: user.id,
      action: "UPDATE",
      entityType: "Company",
      entityId: company.id,
      summary:
        `Fiscal year start changed from ${monthName(plan.currentStartMonth)} to ${monthName(plan.newStartMonth)}, ` +
        `effective FY${plan.effectiveFiscalYear} (${isoDate(plan.effectiveDate)}). ` +
        `${result.periodsCreated} period(s) created` +
        (result.periodsRemoved ? `, ${result.periodsRemoved} unused period(s) replaced` : "") +
        (plan.transition ? `, transition ${isoDate(plan.transition.start)} to ${isoDate(plan.transition.end)}` : "") +
        `. ${plan.postedEntries} posted entr${plan.postedEntries === 1 ? "y" : "ies"} left untouched` +
        (input.reason ? `. Reason: ${input.reason}` : ""),
    });

    revalidatePath("/company");
    revalidatePath("/accounting/periods");
    revalidatePath("/", "layout");

    return {
      ok: true as const,
      message:
        `Fiscal year now starts in ${monthName(plan.newStartMonth)}, effective ` +
        `${isoDate(plan.effectiveDate)} (FY${plan.effectiveFiscalYear}). ` +
        (plan.transition
          ? `A ${plan.transition.months}-month transition covers ${isoDate(plan.transition.start)} to ${isoDate(plan.transition.end)}. `
          : "No transition period was needed. ") +
        `${result.periodsCreated} fiscal period(s) created; existing periods and posted entries are unchanged.`,
    };
  } catch (error) {
    // The transaction rolled back, so nothing was partially applied.
    return { error: (error as Error).message };
  }
}

const numberingSchema = z.object({
  invoicePrefix: z.string().trim().max(10),
  estimatePrefix: z.string().trim().max(10),
  billPrefix: z.string().trim().max(10),
  creditPrefix: z.string().trim().max(10),
  paymentPrefix: z.string().trim().max(10),
  expensePrefix: z.string().trim().max(10),
  journalPrefix: z.string().trim().max(10),
});

/**
 * Prefixes only. The next number itself is never editable here — the sequence
 * is what guarantees documents are gapless, and letting it be typed backwards
 * would produce duplicate invoice numbers.
 */
export async function saveNumberingAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const parsed = numberingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Prefixes must be 10 characters or fewer." };

  await updateCompany(company.id, parsed.data);
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Company",
    entityId: company.id,
    summary: "Document numbering prefixes updated",
  });

  revalidatePath("/company");
  return { ok: true };
}

// ── Users & access ──────────────────────────────────────────────────────────

const inviteSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email("Enter a valid email address."),
  role: z.enum(COMPANY_ROLES),
  temporaryPassword: z.string().min(8, "Use at least 8 characters."),
});

/**
 * There is no outbound mail in this build, so access is granted directly with a
 * temporary password the admin passes on. The membership row is the
 * authorisation — creating the user alone grants nothing.
 */
export async function inviteUserAction(formData: FormData) {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  }
  const input = parsed.data;
  const email = input.email.toLowerCase();

  const subscription = await getSubscriptionForCompany(company.id);
  const memberships = await listMembershipsForCompany(company.id);
  const activeSeats = memberships.filter((m) => ["ACTIVE", "INVITED"].includes(m.status)).length;
  if (subscription && activeSeats >= subscription.seats) {
    return { error: `All ${subscription.seats} seats on the ${subscription.plan.toLowerCase()} plan are in use.` };
  }

  let target = await getUserByEmail(email);
  if (target) {
    const existing = await getMembership(company.id, target.id);
    if (existing) return { error: `${email} already has access to this company.` };
  } else {
    target = await createUser({
      email,
      name: input.name,
      passwordHash: await hashPassword(input.temporaryPassword),
    });
  }

  await upsertMembership({
    companyId: company.id,
    userId: target.id,
    role: input.role,
    status: "INVITED",
    invitedAt: new Date(),
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "CREATE",
    entityType: "CompanyUser",
    entityId: target.id,
    summary: `${email} granted ${input.role.toLowerCase()} access`,
  });

  revalidatePath("/company/users");
  return { ok: true };
}

export async function setMembershipRoleAction(membershipId: string, role: string) {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);
  if (!COMPANY_ROLES.includes(role as (typeof COMPANY_ROLES)[number])) {
    return { error: "That is not a valid role." };
  }

  const targetUserId = userIdFromMembership(membershipId, company.id);
  const membership = targetUserId ? await getMembership(company.id, targetUserId) : null;
  if (!membership || !targetUserId) return { error: "That user is not a member of this company." };
  const memberUser = await getUser(targetUserId);

  // A company must keep at least one active primary user, or nobody can ever
  // grant access again.
  if (membership.role === "PRIMARY" && role !== "PRIMARY") {
    const all = await listMembershipsForCompany(company.id);
    const primaries = all.filter(
      (m) => m.role === "PRIMARY" && m.status === "ACTIVE" && m.id !== membershipId,
    ).length;
    if (primaries === 0) return { error: "This is the last primary user. Promote someone else first." };
  }

  await updateMembership(company.id, targetUserId, { role });
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "CompanyUser",
    entityId: membershipId,
    summary: `${memberUser?.email ?? "user"} role changed to ${role.toLowerCase()}`,
  });

  revalidatePath("/company/users");
  return { ok: true };
}

export async function setMembershipStatusAction(membershipId: string, status: string) {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);
  if (!["ACTIVE", "SUSPENDED"].includes(status)) return { error: "That is not a valid status." };

  const targetUserId = userIdFromMembership(membershipId, company.id);
  const membership = targetUserId ? await getMembership(company.id, targetUserId) : null;
  if (!membership || !targetUserId) return { error: "That user is not a member of this company." };
  if (membership.userId === user.id) return { error: "You cannot suspend your own access." };
  const memberUser = await getUser(targetUserId);

  if (status === "SUSPENDED" && membership.role === "PRIMARY") {
    const all = await listMembershipsForCompany(company.id);
    const primaries = all.filter(
      (m) => m.role === "PRIMARY" && m.status === "ACTIVE" && m.id !== membershipId,
    ).length;
    if (primaries === 0) return { error: "This is the last active primary user." };
  }

  await updateMembership(company.id, targetUserId, {
    status,
    acceptedAt: status === "ACTIVE" ? (membership.acceptedAt ?? new Date()) : membership.acceptedAt,
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "CompanyUser",
    entityId: membershipId,
    summary: `${memberUser?.email ?? "user"} access ${status === "ACTIVE" ? "activated" : "suspended"}`,
  });

  revalidatePath("/company/users");
  return { ok: true };
}

export async function removeMembershipAction(membershipId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);
  const targetUserId = userIdFromMembership(membershipId, company.id);
  const membership = targetUserId ? await getMembership(company.id, targetUserId) : null;
  if (!membership || !targetUserId) return { error: "That user is not a member of this company." };
  if (membership.userId === user.id) return { error: "You cannot remove your own access." };
  const memberUser = await getUser(targetUserId);

  if (membership.role === "PRIMARY") {
    const all = await listMembershipsForCompany(company.id);
    const primaries = all.filter(
      (m) => m.role === "PRIMARY" && m.status === "ACTIVE" && m.id !== membershipId,
    ).length;
    if (primaries === 0) return { error: "This is the last primary user." };
  }

  await deleteMembership(company.id, targetUserId);
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "CompanyUser",
    entityId: membershipId,
    summary: `${memberUser?.email ?? "user"} removed from the company`,
  });

  revalidatePath("/company/users");
  return { ok: true };
}

// ── Subscription ────────────────────────────────────────────────────────────

export async function changePlanAction(plan: string) {
  const { company, user } = await requireCapability(CAPABILITIES.SUBSCRIPTION);

  // The plan, its seat allowance and its price all come from the published
  // catalogue — the single source both this screen and the public pricing page
  // read, so a customer can never be moved onto terms that were never offered.
  const catalogue = await sellablePlanByCode(plan);
  if (!catalogue) return { error: "That is not a plan we offer." };

  const existing = await getSubscriptionForCompany(company.id);

  // A negotiated seat allowance set by Red Leaf support outranks the plan's, and
  // a self-serve plan change must not quietly take those extra seats away.
  const seats =
    existing?.seatsOverridden && existing.seats > catalogue.seats ? existing.seats : catalogue.seats;

  const inUse = (await listMembershipsForCompany(company.id)).filter((m) =>
    ["ACTIVE", "INVITED"].includes(m.status),
  ).length;
  if (inUse > seats) {
    return { error: `${inUse} people have access — the ${catalogue.name} plan only includes ${seats} seats.` };
  }

  // Keep whatever cycle they are already on; changing plan is not a decision to
  // change how often they are billed.
  const assignment = assignmentFromPlan(catalogue, (existing?.billingCycle as never) ?? "MONTHLY");

  if (existing) {
    await subscriptions.update(existing.id, {
      plan: assignment.planCode,
      planId: assignment.planId,
      // The snapshot moves with the plan: this *is* a new agreement, made now,
      // at the price currently published.
      planVersionId: assignment.planVersionId,
      currency: assignment.currency,
      priceCents: assignment.priceCents,
      monthlyEquivalentCents: assignment.monthlyEquivalentCents,
      seats,
    });
  } else {
    await subscriptions.create({
      companyId: company.id,
      plan: assignment.planCode,
      planId: assignment.planId,
      planVersionId: assignment.planVersionId,
      billingCycle: assignment.billingCycle,
      currency: assignment.currency,
      priceCents: assignment.priceCents,
      monthlyEquivalentCents: assignment.monthlyEquivalentCents,
      seats,
      status: "TRIALING",
      trialStartsAt: new Date(),
      trialEndsAt: addDays(new Date(), 30),
    });
  }

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Subscription",
    entityId: company.id,
    summary: `Plan changed from ${existing?.plan ?? "none"} to ${assignment.planCode}`,
  });

  revalidatePath("/company/subscription");
  return { ok: true };
}
