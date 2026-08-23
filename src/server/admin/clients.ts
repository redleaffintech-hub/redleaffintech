/**
 * Client-company administration: searching the book of business, and
 * provisioning a new client end to end.
 *
 * Provisioning is the delicate one. A client account is not one row — it is a
 * company, a user, a membership, a subscription, a chart of accounts, a set of
 * effective-dated tax codes, fiscal periods and tax periods. A half-created
 * client is worse than none at all: it looks real, it appears in every list, and
 * the first thing it does when someone signs in is fail to post. So the whole
 * thing runs in one transaction and either exists completely or not at all.
 */

import "server-only";
import { db } from "@/lib/db";
import { normalizeCurrency, DEFAULT_CURRENCY } from "@/lib/currency";
import { hashPassword } from "@/server/auth/password";
import { provisionCompany } from "@/server/setup/provision";
import { isValidCycle } from "@/lib/plans";
import { AUDIT_ACTIONS, recordPlatformAudit } from "./audit";
import { generateTemporaryPassword } from "./crypto";
import type { AdminActor } from "./guard";

export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientError";
  }
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Listing
// ─────────────────────────────────────────────────────────────────────────────

export const CLIENT_SORTS = {
  created: { label: "Newest first", orderBy: { createdAt: "desc" } },
  name: { label: "Company name", orderBy: { name: "asc" } },
  trial: { label: "Trial ending soonest", orderBy: { subscription: { trialEndsAt: "asc" } } },
  renewal: { label: "Renewing soonest", orderBy: { subscription: { currentPeriodEnd: "asc" } } },
} as const;

export type ClientSort = keyof typeof CLIENT_SORTS;

export interface ClientFilters {
  q?: string;
  plan?: string;
  status?: string;
  sort?: ClientSort;
  page?: number;
  perPage?: number;
}

/**
 * Search across the company *and* the people in it.
 *
 * Matching a primary user's name or email matters more than it sounds: support
 * requests arrive as "a chap called Dev emailed about his file", never as a
 * company's registered legal name.
 */
function clientWhere(filters: ClientFilters) {
  const q = filters.q?.trim();
  const where: Record<string, unknown> = {};

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { legalName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { businessNumber: { contains: q, mode: "insensitive" } },
      { users: { some: { user: { email: { contains: q, mode: "insensitive" } } } } },
      { users: { some: { user: { name: { contains: q, mode: "insensitive" } } } } },
    ];
  }

  const subscription: Record<string, unknown> = {};
  if (filters.plan) subscription.plan = filters.plan;
  if (filters.status) subscription.status = filters.status;
  if (Object.keys(subscription).length > 0) where.subscription = subscription;

  return where;
}

/**
 * One query shape, one place.
 *
 * The select is written inline inside this function rather than hoisted to a
 * shared `as const` object: Prisma infers the result type from the literal at
 * the call site, and a hoisted constant either widens `true` to `boolean` (and
 * loses the inference) or is deeply readonly (and stops matching the generated
 * argument types). Both list callers go through here instead.
 */
function selectClients(args: {
  where: Record<string, unknown>;
  orderBy: unknown;
  skip?: number;
  take: number;
}) {
  return db.company.findMany({
    where: args.where,
    orderBy: args.orderBy as never,
    skip: args.skip,
    take: args.take,
    select: {
      id: true,
      name: true,
      legalName: true,
      email: true,
      phone: true,
      province: true,
      country: true,
      baseCurrency: true,
      isReadOnly: true,
      createdAt: true,
      subscription: {
        select: {
          id: true,
          plan: true,
          status: true,
          billingCycle: true,
          seats: true,
          seatsOverridden: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          priceCents: true,
          currency: true,
        },
      },
      users: {
        where: { status: { in: ["ACTIVE", "INVITED"] } },
        select: {
          role: true,
          status: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

export interface ClientRow {
  id: string;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  province: string;
  country: string;
  baseCurrency: string;
  isReadOnly: boolean;
  createdAt: Date;
  subscription: {
    id: string;
    plan: string;
    status: string;
    billingCycle: string;
    seats: number;
    seatsOverridden: boolean;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    priceCents: number | null;
    currency: string;
  } | null;
  primaryUser: { id: string; name: string; email: string } | null;
  userCount: number;
}

function toClientRow(company: {
  id: string;
  name: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  province: string;
  country: string;
  baseCurrency: string;
  isReadOnly: boolean;
  createdAt: Date;
  subscription: ClientRow["subscription"];
  users: { role: string; status: string; user: { id: string; name: string; email: string } }[];
}): ClientRow {
  const primary = company.users.find((member) => member.role === "PRIMARY");
  return {
    id: company.id,
    name: company.name,
    legalName: company.legalName,
    email: company.email,
    phone: company.phone,
    province: company.province,
    country: company.country,
    baseCurrency: company.baseCurrency,
    isReadOnly: company.isReadOnly,
    createdAt: company.createdAt,
    subscription: company.subscription,
    primaryUser: primary ? primary.user : null,
    userCount: company.users.length,
  };
}

export async function listClients(filters: ClientFilters) {
  const perPage = Math.min(Math.max(filters.perPage ?? 25, 5), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const where = clientWhere(filters);
  const sort = CLIENT_SORTS[filters.sort ?? "created"] ?? CLIENT_SORTS.created;

  const [total, companies] = await Promise.all([
    db.company.count({ where }),
    selectClients({ where, orderBy: sort.orderBy, skip: (page - 1) * perPage, take: perPage }),
  ]);

  return {
    rows: companies.map(toClientRow),
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** The same query without pagination, for the CSV export. Capped so one click cannot pull the whole database. */
export async function listClientsForExport(filters: ClientFilters, cap = 5000) {
  const sort = CLIENT_SORTS[filters.sort ?? "created"] ?? CLIENT_SORTS.created;
  const companies = await selectClients({ where: clientWhere(filters), orderBy: sort.orderBy, take: cap });
  return companies.map(toClientRow);
}

export async function getClient(companyId: string) {
  return db.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      legalName: true,
      businessNumber: true,
      gstNumber: true,
      qstNumber: true,
      pstNumber: true,
      email: true,
      phone: true,
      website: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      postalCode: true,
      province: true,
      country: true,
      baseCurrency: true,
      locale: true,
      industry: true,
      fiscalYearStartMonth: true,
      isReadOnly: true,
      createdAt: true,
      updatedAt: true,
      firm: { select: { id: true, name: true } },
      subscription: true,
      users: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          status: true,
          createdAt: true,
          invitedAt: true,
          acceptedAt: true,
          user: {
            select: { id: true, name: true, email: true, lastLoginAt: true, mustChangePassword: true },
          },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Provisioning
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateClientInput {
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  country?: string;
  province: string;
  baseCurrency?: string;
  fiscalYearStartMonth?: number;
  industry?: string;

  primaryUserName: string;
  primaryUserEmail: string;

  planCode: string;
  billingCycle: string;
  status?: string;
  trialDays?: number;
  seatOverride?: number | null;
  seatOverrideReason?: string | null;
}

export interface CreateClientResult {
  companyId: string;
  userId: string;
  /** Present only when a brand-new user was created and needs a first password. */
  temporaryPassword: string | null;
  attachedExistingUser: boolean;
}

/**
 * Provision a complete client account.
 *
 * An existing email is attached rather than duplicated — the same person can be
 * the primary user of several companies, and creating a second User row for them
 * would give them two logins and split their history. That is the single most
 * likely mistake in this workflow, so it is handled explicitly rather than left
 * to a unique-constraint error.
 */
export async function createClient(actor: AdminActor, input: CreateClientInput): Promise<CreateClientResult> {
  const name = input.name.trim();
  if (!name) throw new ClientError("The company needs a name.");

  const primaryEmail = normalizeEmail(input.primaryUserEmail);
  if (!primaryEmail.includes("@")) throw new ClientError("Enter a valid email for the primary user.");
  const primaryName = input.primaryUserName.trim();
  if (!primaryName) throw new ClientError("The primary user needs a name.");

  if (!isValidCycle(input.billingCycle)) throw new ClientError("Choose a billing cycle.");

  const currency = normalizeCurrency(input.baseCurrency) ?? DEFAULT_CURRENCY;
  const fiscalYearStartMonth = input.fiscalYearStartMonth ?? 1;
  if (fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) {
    throw new ClientError("The fiscal year must start in a real month.");
  }
  if (input.seatOverride != null) {
    if (!Number.isInteger(input.seatOverride) || input.seatOverride < 1) {
      throw new ClientError("A seat override must be a whole number of at least 1.");
    }
    if (!input.seatOverrideReason?.trim()) {
      throw new ClientError("A seat override needs a reason — it is a commercial exception, and it is logged.");
    }
  }

  const existingUser = await db.user.findUnique({
    where: { email: primaryEmail },
    select: { id: true, name: true },
  });

  // Generated before the transaction so the hashing cost (bcrypt, deliberately
  // slow) does not sit inside it holding a connection open.
  const temporaryPassword = existingUser ? null : generateTemporaryPassword();
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

  const result = await db.$transaction(
    async (tx) => {
      const company = await provisionCompany(tx, {
        name,
        legalName: input.legalName?.trim() || name,
        province: input.province,
        country: input.country ?? "CA",
        baseCurrency: currency,
        fiscalYearStartMonth,
        email: input.email?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        industry: input.industry?.trim() || undefined,
        plan: input.planCode,
        billingCycle: input.billingCycle,
        trialDays: input.trialDays,
      });

      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            email: primaryEmail,
            name: primaryName,
            passwordHash: passwordHash!,
            // The generated password is a way in, not a password they chose.
            mustChangePassword: true,
          },
          select: { id: true, name: true },
        }));

      await tx.companyUser.create({
        data: {
          companyId: company.id,
          userId: user.id,
          role: "PRIMARY",
          status: "ACTIVE",
          acceptedAt: existingUser ? new Date() : null,
          invitedAt: new Date(),
        },
      });

      // A user with no active company lands on /onboarding; give the freshly
      // created one somewhere to be, without disturbing an existing user's
      // current company.
      if (!existingUser) {
        await tx.user.update({ where: { id: user.id }, data: { activeCompanyId: company.id } });
      }

      if (input.seatOverride != null) {
        await tx.subscription.updateMany({
          where: { companyId: company.id },
          data: {
            seats: input.seatOverride,
            seatsOverridden: true,
            seatOverrideReason: input.seatOverrideReason!.trim(),
            seatOverrideAt: new Date(),
            seatOverrideById: actor.id,
          },
        });
      }

      return { companyId: company.id, userId: user.id };
    },
    // Provisioning writes a chart of accounts, tax codes and three fiscal years
    // of periods. The default 5s transaction budget is not enough on a cold
    // connection, and a timeout here leaves nothing behind but wasted effort.
    { timeout: 30_000, maxWait: 10_000 },
  );

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.CLIENT_CREATED,
    entityType: "Company",
    entityId: result.companyId,
    summary: `Client "${name}" provisioned on ${input.planCode} with ${primaryEmail} as primary user`,
    after: {
      company: { name, province: input.province, baseCurrency: currency },
      primaryUser: { email: primaryEmail, existing: Boolean(existingUser) },
      plan: input.planCode,
      billingCycle: input.billingCycle,
      seatOverride: input.seatOverride ?? null,
    },
  });

  return {
    ...result,
    temporaryPassword,
    attachedExistingUser: Boolean(existingUser),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Editing
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateClientInput {
  companyId: string;
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postalCode?: string;
  province: string;
  country?: string;
  baseCurrency?: string;
  industry?: string;
  businessNumber?: string;
}

export async function updateClient(actor: AdminActor, input: UpdateClientInput) {
  const before = await db.company.findUnique({
    where: { id: input.companyId },
    select: {
      name: true,
      legalName: true,
      email: true,
      phone: true,
      website: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      postalCode: true,
      province: true,
      country: true,
      baseCurrency: true,
      industry: true,
      businessNumber: true,
    },
  });
  if (!before) throw new ClientError("That client no longer exists.");

  const name = input.name.trim();
  if (!name) throw new ClientError("The company needs a name.");

  const data = {
    name,
    legalName: input.legalName?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    website: input.website?.trim() || null,
    addressLine1: input.addressLine1?.trim() || null,
    addressLine2: input.addressLine2?.trim() || null,
    city: input.city?.trim() || null,
    postalCode: input.postalCode?.trim() || null,
    province: input.province,
    country: input.country?.trim() || "CA",
    // The fiscal-year start is deliberately absent: it becomes read-only once
    // anything is posted, and the company's own settings screen owns that rule.
    baseCurrency: normalizeCurrency(input.baseCurrency) ?? before.baseCurrency,
    industry: input.industry?.trim() || null,
    businessNumber: input.businessNumber?.trim() || null,
  };

  const after = await db.company.update({ where: { id: input.companyId }, data });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.CLIENT_UPDATED,
    entityType: "Company",
    entityId: input.companyId,
    summary: `Client "${after.name}" updated`,
    before,
    after: data,
  });

  return after;
}

/**
 * Put a company into (or out of) read-only by hand.
 *
 * Note this is *not* how suspension works — that is a subscription state, and it
 * sets this flag itself. This is the manual lever, for a client under
 * investigation or one that has asked to be frozen.
 */
export async function setReadOnly(
  actor: AdminActor,
  input: { companyId: string; isReadOnly: boolean; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new ClientError("Give a reason — freezing a client's books is not a silent act.");

  const before = await db.company.findUnique({
    where: { id: input.companyId },
    select: { name: true, isReadOnly: true },
  });
  if (!before) throw new ClientError("That client no longer exists.");

  await db.company.update({ where: { id: input.companyId }, data: { isReadOnly: input.isReadOnly } });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.CLIENT_READONLY_CHANGED,
    entityType: "Company",
    entityId: input.companyId,
    summary: `${before.name} set ${input.isReadOnly ? "read-only" : "writable"}`,
    reason,
    before: { isReadOnly: before.isReadOnly },
    after: { isReadOnly: input.isReadOnly },
  });
}
