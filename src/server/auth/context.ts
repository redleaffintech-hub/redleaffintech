/**
 * Request context and the tenant boundary (spec §3, §27).
 *
 * `requireCompany()` is the single place that answers "which company is this
 * request allowed to touch, and as what role". Every page and every action
 * resolves the company through it, so a company id from a URL can never be
 * trusted on its own.
 */

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import type { CompanyRole } from "@/lib/enums";
import { canView, PermissionError, requirePermission, type Capability } from "@/lib/permissions";
import { readSession } from "./session";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  isPlatformAdmin: boolean;
  activeCompanyId: string | null;
}

export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const session = await readSession();
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, isPlatformAdmin: true, activeCompanyId: true },
  });
  return user;
});

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export interface CompanyContext {
  user: AppUser;
  company: {
    id: string;
    name: string;
    legalName: string | null;
    province: string;
    baseCurrency: string;
    locale: string;
    fiscalYearStartMonth: number;
    gstNumber: string | null;
    qstNumber: string | null;
    pstNumber: string | null;
    businessNumber: string | null;
    isReadOnly: boolean;
    defaultTaxInclusive: boolean;
    defaultPaymentTermsDays: number;
    logoUrl: string | null;
    /** Never empty in practice — requireCompany() falls back to ["ACCOUNTING"] rather than trust an unset default. */
    enabledModules: string[];
  };
  role: CompanyRole;
  /** Every company this user may switch to. */
  memberships: { companyId: string; companyName: string; role: CompanyRole }[];
}

/**
 * Resolve the active company. The membership row IS the authorisation: a user
 * with no CompanyUser record for a company gets no access to it, and an
 * accountant must be explicitly granted each client (§3).
 */
// The one place CompanyContext.company's field list is spelled out — shared
// between the membership query below and the type of `company` above so the
// two can never drift apart.
const COMPANY_CONTEXT_SELECT = {
  id: true, name: true, legalName: true, province: true, baseCurrency: true, locale: true,
  fiscalYearStartMonth: true, gstNumber: true, qstNumber: true, pstNumber: true,
  businessNumber: true, isReadOnly: true,
  defaultTaxInclusive: true, defaultPaymentTermsDays: true, logoUrl: true, enabledModules: true,
} as const;

export const requireCompany = cache(async (companyId?: string): Promise<CompanyContext> => {
  const user = await requireUser();

  // One query, not two (§ perf review, 16 Sep 2026): the membership row's own
  // join already reaches every company this user belongs to, so selecting
  // the full field set here — instead of just id/name, with a second
  // `company.findUniqueOrThrow` afterward for the active one — trades a few
  // extra columns on what's almost always a handful of rows for dropping a
  // whole round trip on every single request.
  const memberships = await db.companyUser.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    include: { company: { select: COMPANY_CONTEXT_SELECT } },
    orderBy: { company: { name: "asc" } },
  });
  if (memberships.length === 0) redirect("/onboarding");

  const targetId = companyId ?? user.activeCompanyId ?? memberships[0].companyId;
  const membership =
    memberships.find((m) => m.companyId === targetId) ?? memberships[0];

  // An unset module list is "not configured yet", not "nothing" — a company
  // must never be locked out of its own books by an admin who never visited
  // the modules panel.
  const company = {
    ...membership.company,
    enabledModules: membership.company.enabledModules.length > 0 ? membership.company.enabledModules : ["ACCOUNTING"],
  };

  return {
    user,
    company,
    role: membership.role as CompanyRole,
    memberships: memberships.map((m) => ({
      companyId: m.companyId,
      companyName: m.company.name,
      role: m.role as CompanyRole,
    })),
  };
});

/**
 * Guard an entire route group behind a product module — everything under
 * `/hr`, `/payroll` and `/inventory` calls this from that segment's own
 * `layout.tsx`, which is what makes it a hard block rather than a hidden nav
 * link: hitting the URL directly still redirects. Modules without their own
 * route prefix (Accounting, Payments — both live under existing Sales/
 * Purchases/Accounting pages) have nothing to gate here.
 */
export async function requireModule(moduleId: string): Promise<CompanyContext> {
  const context = await requireCompany();
  if (!context.company.enabledModules.includes(moduleId)) redirect("/dashboard");
  return context;
}

/** Guard a server action or page section behind a capability from §34. */
export async function requireCapability(capability: Capability): Promise<CompanyContext> {
  const context = await requireCompany();
  requirePermission(context.role, capability);
  return context;
}

/**
 * Read access to a screen whose contents some roles may only look at. The page
 * still has to check `can()` before offering any action — VIEW means read.
 */
export async function requireVisible(capability: Capability): Promise<CompanyContext> {
  const context = await requireCompany();
  if (!canView(context.role, capability)) throw new PermissionError(capability, context.role);
  return context;
}

export async function switchCompany(companyId: string) {
  const user = await requireUser();
  const membership = await db.companyUser.findFirst({
    where: { userId: user.id, companyId, status: "ACTIVE" },
  });
  if (!membership) throw new Error("You do not have access to that company.");
  await db.user.update({ where: { id: user.id }, data: { activeCompanyId: companyId } });
}

export async function recordAudit(input: {
  companyId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  metadata?: unknown;
}) {
  await db.auditLog.create({
    data: {
      companyId: input.companyId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}
