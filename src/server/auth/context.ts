/**
 * Request context and the tenant boundary (§3, §27).
 *
 * `requireCompany()` is the single place that answers "which company is this
 * request allowed to touch, and as what role". Every page and every action
 * resolves the company through it, so a company id from a URL can never be
 * trusted on its own.
 */

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { CompanyRole } from "@/lib/enums";
import { canView, PermissionError, requirePermission, type Capability } from "@/lib/permissions";
import { getCompany, getCompanyOrThrow } from "@/server/db/companies";
import {
  getMembership,
  listMembershipsForUser,
  updateMembership,
} from "@/server/db/company-users";
import { recordAudit as writeAudit } from "@/server/db/audit-logs";
import { getUser, updateUser } from "@/server/db/users";
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
  const user = await getUser(session.userId);
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isPlatformAdmin: user.isPlatformAdmin,
    activeCompanyId: user.activeCompanyId,
  };
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
    enabledModules: string[];
  };
  role: CompanyRole;
  memberships: { companyId: string; companyName: string; role: CompanyRole }[];
}

export const requireCompany = cache(async (companyId?: string): Promise<CompanyContext> => {
  const user = await requireUser();

  const memberships = await listMembershipsForUser(user.id, { status: "ACTIVE" });
  if (memberships.length === 0) redirect("/onboarding");

  // Names for the company switcher.
  const names = new Map<string, string>();
  await Promise.all(
    memberships.map(async (m) => {
      const c = await getCompany(m.companyId);
      names.set(m.companyId, c?.name ?? "—");
    }),
  );
  memberships.sort((a, b) => (names.get(a.companyId) ?? "").localeCompare(names.get(b.companyId) ?? ""));

  const targetId = companyId ?? user.activeCompanyId ?? memberships[0].companyId;
  const membership = memberships.find((m) => m.companyId === targetId) ?? memberships[0];

  const c = await getCompanyOrThrow(membership.companyId);
  const company = {
    id: c.id,
    name: c.name,
    legalName: c.legalName,
    province: c.province,
    baseCurrency: c.baseCurrency,
    locale: c.locale,
    fiscalYearStartMonth: c.fiscalYearStartMonth,
    gstNumber: c.gstNumber,
    qstNumber: c.qstNumber,
    pstNumber: c.pstNumber,
    businessNumber: c.businessNumber,
    isReadOnly: c.isReadOnly,
    defaultTaxInclusive: c.defaultTaxInclusive,
    defaultPaymentTermsDays: c.defaultPaymentTermsDays,
    logoUrl: c.logoUrl,
    enabledModules: c.enabledModules.length > 0 ? c.enabledModules : ["ACCOUNTING"],
  };

  return {
    user,
    company,
    role: membership.role as CompanyRole,
    memberships: memberships.map((m) => ({
      companyId: m.companyId,
      companyName: names.get(m.companyId) ?? "—",
      role: m.role as CompanyRole,
    })),
  };
});

export async function requireModule(moduleId: string): Promise<CompanyContext> {
  const context = await requireCompany();
  if (!context.company.enabledModules.includes(moduleId)) redirect("/dashboard");
  return context;
}

export async function requireCapability(capability: Capability): Promise<CompanyContext> {
  const context = await requireCompany();
  requirePermission(context.role, capability);
  return context;
}

export async function requireVisible(capability: Capability): Promise<CompanyContext> {
  const context = await requireCompany();
  if (!canView(context.role, capability)) throw new PermissionError(capability, context.role);
  return context;
}

export async function switchCompany(companyId: string) {
  const user = await requireUser();
  const membership = await getMembership(companyId, user.id);
  if (!membership || membership.status !== "ACTIVE") {
    throw new Error("You do not have access to that company.");
  }
  await updateUser(user.id, { activeCompanyId: companyId });
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
  await writeAudit(input);
}

// Kept for callers that update a membership through the context module.
export { updateMembership };
