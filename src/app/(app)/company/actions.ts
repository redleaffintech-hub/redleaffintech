"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { normalizeCurrency } from "@/lib/currency";
import { COMPANY_ROLES, PROVINCES } from "@/lib/enums";
import { CAPABILITIES } from "@/lib/permissions";
import { PLAN_SEATS } from "@/lib/plans";
import { hashPassword } from "@/server/auth/password";
import { recordAudit, requireCapability } from "@/server/auth/context";

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
    const posted = await db.journalEntry.count({ where: { companyId: company.id } });
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

  // The fiscal year start defines every period boundary. Once anything has been
  // posted, moving it would silently re-file historical entries into the wrong
  // year, so it becomes read-only rather than being quietly re-applied.
  if (input.fiscalYearStartMonth !== company.fiscalYearStartMonth) {
    const posted = await db.journalEntry.count({ where: { companyId: company.id } });
    if (posted > 0) {
      return {
        error: `The fiscal year start cannot change once ${posted} entries have been posted. Start a new company file instead.`,
      };
    }
  }

  await db.company.update({
    where: { id: company.id },
    data: {
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
      fiscalYearStartMonth: input.fiscalYearStartMonth,
      defaultPaymentTermsDays: input.defaultPaymentTermsDays,
      defaultTaxInclusive: input.defaultTaxInclusive === "on",
      invoiceFooter: input.invoiceFooter || null,
    },
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
  return { ok: true };
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

  await db.company.update({ where: { id: company.id }, data: parsed.data });
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

  const subscription = await db.subscription.findUnique({ where: { companyId: company.id } });
  const activeSeats = await db.companyUser.count({
    where: { companyId: company.id, status: { in: ["ACTIVE", "INVITED"] } },
  });
  if (subscription && activeSeats >= subscription.seats) {
    return { error: `All ${subscription.seats} seats on the ${subscription.plan.toLowerCase()} plan are in use.` };
  }

  let target = await db.user.findUnique({ where: { email } });
  if (target) {
    const existing = await db.companyUser.findFirst({ where: { companyId: company.id, userId: target.id } });
    if (existing) return { error: `${email} already has access to this company.` };
  } else {
    target = await db.user.create({
      data: {
        email,
        name: input.name,
        passwordHash: await hashPassword(input.temporaryPassword),
      },
    });
  }

  await db.companyUser.create({
    data: {
      companyId: company.id,
      userId: target.id,
      role: input.role,
      status: "INVITED",
      invitedAt: new Date(),
    },
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

  const membership = await db.companyUser.findFirst({
    where: { id: membershipId, companyId: company.id },
    include: { user: { select: { email: true } } },
  });
  if (!membership) return { error: "That user is not a member of this company." };

  // A company must keep at least one active primary user, or nobody can ever
  // grant access again.
  if (membership.role === "PRIMARY" && role !== "PRIMARY") {
    const primaries = await db.companyUser.count({
      where: { companyId: company.id, role: "PRIMARY", status: "ACTIVE", NOT: { id: membershipId } },
    });
    if (primaries === 0) return { error: "This is the last primary user. Promote someone else first." };
  }

  await db.companyUser.update({ where: { id: membershipId }, data: { role } });
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "CompanyUser",
    entityId: membershipId,
    summary: `${membership.user.email} role changed to ${role.toLowerCase()}`,
  });

  revalidatePath("/company/users");
  return { ok: true };
}

export async function setMembershipStatusAction(membershipId: string, status: string) {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);
  if (!["ACTIVE", "SUSPENDED"].includes(status)) return { error: "That is not a valid status." };

  const membership = await db.companyUser.findFirst({
    where: { id: membershipId, companyId: company.id },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!membership) return { error: "That user is not a member of this company." };
  if (membership.userId === user.id) return { error: "You cannot suspend your own access." };

  if (status === "SUSPENDED" && membership.role === "PRIMARY") {
    const primaries = await db.companyUser.count({
      where: { companyId: company.id, role: "PRIMARY", status: "ACTIVE", NOT: { id: membershipId } },
    });
    if (primaries === 0) return { error: "This is the last active primary user." };
  }

  await db.companyUser.update({
    where: { id: membershipId },
    data: { status, acceptedAt: status === "ACTIVE" ? (membership.acceptedAt ?? new Date()) : membership.acceptedAt },
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "CompanyUser",
    entityId: membershipId,
    summary: `${membership.user.email} access ${status === "ACTIVE" ? "activated" : "suspended"}`,
  });

  revalidatePath("/company/users");
  return { ok: true };
}

export async function removeMembershipAction(membershipId: string) {
  const { company, user } = await requireCapability(CAPABILITIES.USERS);
  const membership = await db.companyUser.findFirst({
    where: { id: membershipId, companyId: company.id },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!membership) return { error: "That user is not a member of this company." };
  if (membership.userId === user.id) return { error: "You cannot remove your own access." };

  if (membership.role === "PRIMARY") {
    const primaries = await db.companyUser.count({
      where: { companyId: company.id, role: "PRIMARY", status: "ACTIVE", NOT: { id: membershipId } },
    });
    if (primaries === 0) return { error: "This is the last primary user." };
  }

  await db.companyUser.delete({ where: { id: membershipId } });
  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "CompanyUser",
    entityId: membershipId,
    summary: `${membership.user.email} removed from the company`,
  });

  revalidatePath("/company/users");
  return { ok: true };
}

// ── Subscription ────────────────────────────────────────────────────────────

export async function changePlanAction(plan: string) {
  const { company, user } = await requireCapability(CAPABILITIES.SUBSCRIPTION);
  const seats = PLAN_SEATS[plan];
  if (!seats) return { error: "That is not a plan we offer." };

  const inUse = await db.companyUser.count({
    where: { companyId: company.id, status: { in: ["ACTIVE", "INVITED"] } },
  });
  if (inUse > seats) {
    return { error: `${inUse} people have access — the ${plan.toLowerCase()} plan only includes ${seats} seats.` };
  }

  const existing = await db.subscription.findUnique({ where: { companyId: company.id } });
  await db.subscription.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      plan,
      seats,
      status: "TRIALING",
      trialEndsAt: addDays(new Date(), 30),
    },
    update: { plan, seats },
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "UPDATE",
    entityType: "Subscription",
    entityId: company.id,
    summary: `Plan changed from ${existing?.plan ?? "none"} to ${plan}`,
  });

  revalidatePath("/company/subscription");
  return { ok: true };
}
