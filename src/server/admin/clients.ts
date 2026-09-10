/**
 * Client-company administration: searching the book of business, provisioning a
 * new client, editing, freezing, module access, and deletion.
 *
 * DEVIATION: Firestore has no cross-collection transaction, so `createClient`
 * runs `provisionCompany` (itself a BulkWriter batch) then the user / membership
 * / seat-override writes in sequence. A failure after the company exists leaves
 * an incomplete client — the caller (or a support follow-up) deletes it. And
 * there is no `onDelete: Cascade`; `deleteClient` uses `recursiveDelete` on the
 * company doc plus explicit sweeps of the top-level companyUsers / subscription.
 */

import "server-only";
import { normalizeCurrency, DEFAULT_CURRENCY } from "@/lib/currency";
import { hashPassword } from "@/server/auth/password";
import { isValidCycle } from "@/lib/plans";
import { provisionCompany } from "@/server/setup/provision";
import { getCompany, updateCompany } from "@/server/db/companies";
import { createUser as createUserDoc, getUserByEmail, updateUser } from "@/server/db/users";
import {
  listMembershipsForCompany,
  upsertMembership,
} from "@/server/db/company-users";
import {
  firms,
  getSubscriptionForCompany,
  subscriptions as subsRepo,
} from "@/server/db/platform";
import { companyRef, db, top } from "@/server/db/firestore";
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

const ts = (t: FirebaseFirestore.Timestamp | null | undefined) => t?.toDate?.() ?? null;

// ── Listing ────────────────────────────────────────────────────────────────

export const CLIENT_SORTS = {
  created: { label: "Newest first" },
  name: { label: "Company name" },
  trial: { label: "Trial ending soonest" },
  renewal: { label: "Renewing soonest" },
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

async function allClientRows(): Promise<ClientRow[]> {
  const [companySnap, cuSnap, userSnap, subs] = await Promise.all([
    db.collection("companies").get(),
    top("companyUsers").get(),
    top("users").get(),
    subsRepo.list(),
  ]);
  const userById = new Map(
    userSnap.docs.map((d) => [d.id, { id: d.id, name: d.data().name as string, email: d.data().email as string }]),
  );
  const subByCompany = new Map(subs.map((s) => [s.companyId, s]));
  const membersByCompany = new Map<string, { role: string; status: string; userId: string }[]>();
  for (const d of cuSnap.docs) {
    const c = d.data();
    if (!["ACTIVE", "INVITED"].includes(c.status)) continue;
    const list = membersByCompany.get(c.companyId) ?? [];
    list.push({ role: c.role, status: c.status, userId: c.userId });
    membersByCompany.set(c.companyId, list);
  }

  return companySnap.docs.map((d) => {
    const x = d.data();
    const s = subByCompany.get(d.id) ?? null;
    const members = membersByCompany.get(d.id) ?? [];
    const primary = members.find((m) => m.role === "PRIMARY");
    return {
      id: d.id,
      name: x.name,
      legalName: x.legalName ?? null,
      email: x.email ?? null,
      phone: x.phone ?? null,
      province: x.province,
      country: x.country,
      baseCurrency: x.baseCurrency,
      isReadOnly: x.isReadOnly ?? false,
      createdAt: ts(x.createdAt) ?? new Date(0),
      subscription: s
        ? {
            id: s.id,
            plan: s.plan,
            status: s.status,
            billingCycle: s.billingCycle,
            seats: s.seats,
            seatsOverridden: s.seatsOverridden,
            trialEndsAt: s.trialEndsAt,
            currentPeriodEnd: s.currentPeriodEnd,
            priceCents: s.priceCents,
            currency: s.currency,
          }
        : null,
      primaryUser: primary ? userById.get(primary.userId) ?? null : null,
      userCount: members.length,
    };
  });
}

function applyFilters(rows: ClientRow[], filters: ClientFilters): ClientRow[] {
  let out = rows;
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.legalName ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.primaryUser?.email ?? "").toLowerCase().includes(q) ||
        (r.primaryUser?.name ?? "").toLowerCase().includes(q),
    );
  }
  if (filters.plan) out = out.filter((r) => r.subscription?.plan === filters.plan);
  if (filters.status) out = out.filter((r) => r.subscription?.status === filters.status);

  const sort = filters.sort ?? "created";
  out = [...out].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.name.localeCompare(b.name);
      case "trial":
        return (
          (a.subscription?.trialEndsAt?.getTime() ?? Infinity) -
          (b.subscription?.trialEndsAt?.getTime() ?? Infinity)
        );
      case "renewal":
        return (
          (a.subscription?.currentPeriodEnd?.getTime() ?? Infinity) -
          (b.subscription?.currentPeriodEnd?.getTime() ?? Infinity)
        );
      default:
        return b.createdAt.getTime() - a.createdAt.getTime();
    }
  });
  return out;
}

export async function listClients(filters: ClientFilters) {
  const perPage = Math.min(Math.max(filters.perPage ?? 25, 5), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const filtered = applyFilters(await allClientRows(), filters);
  const total = filtered.length;
  return {
    rows: filtered.slice((page - 1) * perPage, page * perPage),
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function listClientsForExport(filters: ClientFilters, cap = 5000) {
  return applyFilters(await allClientRows(), filters).slice(0, cap);
}

export async function getClient(companyId: string) {
  const company = await getCompany(companyId);
  if (!company) return null;

  const [firm, subscription, memberships] = await Promise.all([
    company.firmId ? firms.get(company.firmId) : Promise.resolve(null),
    getSubscriptionForCompany(companyId),
    listMembershipsForCompany(companyId),
  ]);
  const users = await Promise.all(
    memberships
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(async (m) => {
        const u = await getUserByIdLite(m.userId);
        return {
          id: `${companyId}__${m.userId}`,
          role: m.role,
          status: m.status,
          createdAt: m.createdAt,
          invitedAt: m.invitedAt,
          acceptedAt: m.acceptedAt,
          user: u,
        };
      }),
  );

  return {
    ...company,
    firm: firm ? { id: firm.id, name: firm.name } : null,
    subscription,
    users,
  };
}

async function getUserByIdLite(userId: string) {
  const d = await top("users").doc(userId).get();
  if (!d.exists) return { id: userId, name: "—", email: "—", lastLoginAt: null, mustChangePassword: false };
  const x = d.data()!;
  return {
    id: userId,
    name: x.name as string,
    email: x.email as string,
    lastLoginAt: ts(x.lastLoginAt),
    mustChangePassword: (x.mustChangePassword as boolean) ?? false,
  };
}

// ── Provisioning ───────────────────────────────────────────────────────────

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
  enabledModules?: string[];
}

export interface CreateClientResult {
  companyId: string;
  userId: string;
  temporaryPassword: string | null;
  attachedExistingUser: boolean;
}

export async function createClient(
  actor: AdminActor,
  input: CreateClientInput,
): Promise<CreateClientResult> {
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

  const existingUser = await getUserByEmail(primaryEmail);
  const temporaryPassword = existingUser ? null : generateTemporaryPassword();
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : null;

  const company = await provisionCompany(null, {
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
    enabledModules: input.enabledModules,
  });

  const user =
    existingUser ??
    (await createUserDoc({
      email: primaryEmail,
      name: primaryName,
      passwordHash: passwordHash!,
      mustChangePassword: true,
    }));

  await upsertMembership({
    companyId: company.id,
    userId: user.id,
    role: "PRIMARY",
    status: "ACTIVE",
    acceptedAt: existingUser ? new Date() : null,
    invitedAt: new Date(),
  });

  if (!existingUser) await updateUser(user.id, { activeCompanyId: company.id });

  if (input.seatOverride != null) {
    const sub = await getSubscriptionForCompany(company.id);
    if (sub) {
      await subsRepo.update(sub.id, {
        seats: input.seatOverride,
        seatsOverridden: true,
        seatOverrideReason: input.seatOverrideReason!.trim(),
        seatOverrideAt: new Date(),
        seatOverrideById: actor.id,
      });
    }
  }

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.CLIENT_CREATED,
    entityType: "Company",
    entityId: company.id,
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
    companyId: company.id,
    userId: user.id,
    temporaryPassword,
    attachedExistingUser: Boolean(existingUser),
  };
}

// ── Editing ────────────────────────────────────────────────────────────────

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
  const before = await getCompany(input.companyId);
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
    baseCurrency: normalizeCurrency(input.baseCurrency) ?? before.baseCurrency,
    industry: input.industry?.trim() || null,
    businessNumber: input.businessNumber?.trim() || null,
  };

  await updateCompany(input.companyId, data);

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.CLIENT_UPDATED,
    entityType: "Company",
    entityId: input.companyId,
    summary: `Client "${name}" updated`,
    before: {
      name: before.name,
      legalName: before.legalName,
      email: before.email,
      province: before.province,
      businessNumber: before.businessNumber,
    },
    after: data,
  });

  return { ...before, ...data };
}

export async function setReadOnly(
  actor: AdminActor,
  input: { companyId: string; isReadOnly: boolean; reason: string },
) {
  const reason = input.reason?.trim();
  if (!reason) throw new ClientError("Give a reason — freezing a client's books is not a silent act.");

  const before = await getCompany(input.companyId);
  if (!before) throw new ClientError("That client no longer exists.");

  await updateCompany(input.companyId, { isReadOnly: input.isReadOnly });

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

export async function setClientModules(
  actor: AdminActor,
  input: { companyId: string; enabledModules: string[] },
) {
  const before = await getCompany(input.companyId);
  if (!before) throw new ClientError("That client no longer exists.");

  const enabledModules = Array.from(new Set(["ACCOUNTING", ...input.enabledModules]));
  await updateCompany(input.companyId, { enabledModules });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.CLIENT_MODULES_CHANGED,
    entityType: "Company",
    entityId: input.companyId,
    summary: `${before.name} modules set to ${enabledModules.join(", ")}`,
    before: { enabledModules: before.enabledModules },
    after: { enabledModules },
  });
}

/**
 * Permanently delete a client company and everything in it. Firestore has no
 * cascade: `recursiveDelete` clears `companies/{id}` and every subcollection,
 * then the top-level companyUsers / subscription / subscriptionCompanies rows
 * are swept explicitly. User rows are left — a login belongs to the person.
 */
export async function deleteClient(
  actor: AdminActor,
  input: { companyId: string; confirmName: string },
) {
  const company = await getCompany(input.companyId);
  if (!company) throw new ClientError("That client no longer exists.");
  if (input.confirmName.trim() !== company.name) {
    throw new ClientError(`Type "${company.name}" exactly to confirm — deleting a client cannot be undone.`);
  }

  const [members, invoiceSnap, journalSnap] = await Promise.all([
    listMembershipsForCompany(input.companyId),
    companyRef(input.companyId).collection("invoices").get(),
    companyRef(input.companyId).collection("journalEntries").get(),
  ]);
  const userCount = members.length;
  const invoiceCount = invoiceSnap.size;
  const journalCount = journalSnap.size;

  await db.recursiveDelete(companyRef(input.companyId));

  const batch = db.batch();
  for (const m of members) {
    batch.delete(top("companyUsers").doc(`${input.companyId}__${m.userId}`));
  }
  const sub = await getSubscriptionForCompany(input.companyId);
  if (sub) batch.delete(top("subscriptions").doc(sub.id));
  batch.delete(top("subscriptionCompanies").doc(input.companyId));
  await batch.commit();

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.CLIENT_DELETED,
    entityType: "Company",
    entityId: input.companyId,
    summary: `${company.name} permanently deleted (${userCount} membership(s), ${invoiceCount} invoice(s), ${journalCount} journal entr${journalCount === 1 ? "y" : "ies"})`,
    before: { name: company.name, userCount, invoiceCount, journalCount },
  });
}
