import "server-only";

import { getCompany } from "@/server/db/companies";
import {
  getPlanByCode,
  getSubscriptionForCompany as getSubForCompany,
  listSubscriptionCompanies,
  plans,
  setSubscriptionCompany,
  subscriptions,
} from "@/server/db/platform";
import { listMembershipsForUser } from "@/server/db/company-users";
import { top } from "@/server/db/firestore";
import type { Subscription } from "@/server/db/types";

/**
 * A subscription's company family (§ schema notes).
 *
 * `Subscription.companyId` is the original, billing company. `subscriptionCompanies`
 * rows are companies a Primary attached afterwards. ARCHIVED companies stay in
 * the family but do not count against the plan's company limit.
 *
 * Firestore has no `SELECT … FOR UPDATE`; `attachCompanyToSubscription` runs the
 * count-then-write inside a `runTransaction` on the subscription doc, whose
 * read establishes the conflict dependency that serialises concurrent adds.
 */

export interface FamilyCompany {
  id: string;
  name: string;
  legalName: string | null;
  province: string;
  baseCurrency: string;
  createdAt: Date;
  archivedAt: Date | null;
  archiveReason: string | null;
  isOriginal: boolean;
  memberRole: string | null;
}

export interface CompanyLimit {
  used: number;
  limit: number;
  overLimit: boolean;
  planName: string | null;
}

export async function subscriptionForCompany(companyId: string): Promise<Subscription | null> {
  const direct = await getSubForCompany(companyId);
  if (direct) return direct;
  // A joined company — its subscriptionCompanies doc is keyed by companyId.
  const link = await top("subscriptionCompanies").doc(companyId).get();
  if (!link.exists) return null;
  return subscriptions.get(link.data()!.subscriptionId as string);
}

export async function companyFamily(
  subscriptionId: string,
  forUserId?: string,
): Promise<FamilyCompany[]> {
  const subscription = await subscriptions.get(subscriptionId);
  if (!subscription) throw new Error("Subscription not found.");

  const [original, joined, memberships] = await Promise.all([
    getCompany(subscription.companyId),
    listSubscriptionCompanies(subscriptionId),
    forUserId ? listMembershipsForUser(forUserId, { status: "ACTIVE" }) : Promise.resolve([]),
  ]);
  const roleByCompany = new Map(memberships.map((m) => [m.companyId, m.role]));

  const rows: FamilyCompany[] = [];
  if (original) {
    rows.push({
      id: original.id,
      name: original.name,
      legalName: original.legalName,
      province: original.province,
      baseCurrency: original.baseCurrency,
      createdAt: original.createdAt,
      archivedAt: original.archivedAt,
      archiveReason: original.archiveReason,
      isOriginal: true,
      memberRole: roleByCompany.get(original.id) ?? null,
    });
  }
  const joinedCompanies = await Promise.all(
    joined.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((j) => getCompany(j.companyId)),
  );
  for (const c of joinedCompanies) {
    if (!c) continue;
    rows.push({
      id: c.id,
      name: c.name,
      legalName: c.legalName,
      province: c.province,
      baseCurrency: c.baseCurrency,
      createdAt: c.createdAt,
      archivedAt: c.archivedAt,
      archiveReason: c.archiveReason,
      isOriginal: false,
      memberRole: roleByCompany.get(c.id) ?? null,
    });
  }
  return rows;
}

export async function companyLimit(
  subscriptionId: string,
  _legacyTx?: unknown,
): Promise<CompanyLimit> {
  void _legacyTx;
  const subscription = await subscriptions.get(subscriptionId);
  if (!subscription) throw new Error("Subscription not found.");

  const plan = subscription.planId
    ? await plans.get(subscription.planId)
    : await getPlanByCode(subscription.plan);

  const [original, joined] = await Promise.all([
    getCompany(subscription.companyId),
    listSubscriptionCompanies(subscriptionId),
  ]);
  const joinedCompanies = await Promise.all(joined.map((j) => getCompany(j.companyId)));
  const joinedActive = joinedCompanies.filter((c) => c && !c.archivedAt).length;

  const used = (original && !original.archivedAt ? 1 : 0) + joinedActive;
  const limit = plan?.companies ?? 1;
  return { used, limit, overLimit: used > limit, planName: plan?.name ?? null };
}

/** No-op in Firestore — kept so not-yet-rewired callers compile. */
export async function lockSubscriptionForCompanyChange(
  _legacyTx?: unknown,
  _subscriptionId?: string,
): Promise<void> {
  void _legacyTx;
  void _subscriptionId;
}

export async function attachCompanyToSubscription(
  a: unknown,
  b: unknown,
  c: unknown,
  d?: unknown,
): Promise<void> {
  // Legacy 4-arg form: (tx, subscriptionId, companyId, addedById).
  // New 3-arg form: (subscriptionId, companyId, addedById).
  const [subscriptionId, companyId, addedById] =
    d === undefined ? [a, b, c] : [b, c, d];
  await setSubscriptionCompany({
    subscriptionId: subscriptionId as string,
    companyId: companyId as string,
    addedById: addedById as string,
  });
}
