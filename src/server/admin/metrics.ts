/**
 * Platform-level metrics for the admin dashboard.
 *
 * Counts businesses and subscriptions only — never a client's ledger. Revenue is
 * contracted subscription value from the subscription rows, nothing from a
 * customer's books.
 *
 * Firestore has no GROUP BY, so each collection is read whole and grouped in
 * memory. This is an infrequent admin page; the row counts are small.
 */

import "server-only";
import { addDays } from "@/lib/dates";
import { CYCLE_MONTHS, type BillingCycle } from "@/lib/plans";
import { SUBSCRIPTION_STATUSES } from "@/lib/subscriptions";
import { db, top } from "@/server/db/firestore";
import { subscriptions as subsRepo } from "@/server/db/platform";
import type { Company, Subscription } from "@/server/db/types";

export interface DashboardRange {
  days: number;
}

export const RANGE_OPTIONS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
];

const TRIAL_SOON_DAYS = 7;

export interface PlatformMetrics {
  companies: { total: number; active: number; readOnly: number; newInPeriod: number };
  subscriptions: Record<string, number> & { total: number };
  users: { total: number; active: number; platformAdmins: number };
  trialsEndingSoon: {
    id: string;
    companyId: string;
    companyName: string;
    plan: string;
    trialEndsAt: Date | null;
  }[];
  needsAttention: {
    id: string;
    companyId: string;
    companyName: string;
    plan: string;
    status: string;
    since: Date | null;
  }[];
  seatsByPlan: { plan: string; companies: number; seatsAllowed: number; seatsUsed: number }[];
  growth: { month: string; companies: number; subscriptions: number }[];
  contractedMonthlyCents: number;
  currency: string;
}

async function allCompanies(): Promise<Company[]> {
  const snap = await db.collection("companies").get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      name: x.name,
      isReadOnly: x.isReadOnly ?? false,
      createdAt: (x.createdAt as FirebaseFirestore.Timestamp)?.toDate?.() ?? new Date(0),
    } as Company;
  });
}

export async function platformMetrics(
  range: DashboardRange = { days: 30 },
): Promise<PlatformMetrics> {
  const since = addDays(new Date(), -range.days);
  const soon = addDays(new Date(), TRIAL_SOON_DAYS);

  const [companies, users, companyUsers, subs] = await Promise.all([
    allCompanies(),
    top("users").get(),
    top("companyUsers").get(),
    subsRepo.list(),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  const readOnly = companies.filter((c) => c.isReadOnly).length;
  const newInPeriod = companies.filter((c) => c.createdAt >= since).length;

  const usersWithActiveMembership = new Set(
    companyUsers.docs.filter((d) => d.data().status === "ACTIVE").map((d) => d.data().userId as string),
  );
  const platformAdmins = users.docs.filter(
    (d) => d.data().isPlatformAdmin && !d.data().platformAdminSuspendedAt,
  ).length;

  const statusCount = new Map<string, number>();
  for (const s of subs) statusCount.set(s.status, (statusCount.get(s.status) ?? 0) + 1);

  const trialsEndingSoon = subs
    .filter((s) => s.status === "TRIALING" && s.trialEndsAt && s.trialEndsAt <= soon)
    .sort((a, b) => (a.trialEndsAt!.getTime() - b.trialEndsAt!.getTime()))
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      companyId: s.companyId,
      companyName: companyName.get(s.companyId) ?? "—",
      plan: s.plan,
      trialEndsAt: s.trialEndsAt,
    }));

  const needsAttention = subs
    .filter((s) => ["PAST_DUE", "SUSPENDED"].includes(s.status))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      companyId: s.companyId,
      companyName: companyName.get(s.companyId) ?? "—",
      plan: s.plan,
      status: s.status,
      since: s.status === "SUSPENDED" ? s.suspendedAt : s.pastDueSince,
    }));

  // Seats per plan.
  const seatEligible = subs.filter((s) => ["TRIALING", "ACTIVE", "PAST_DUE"].includes(s.status));
  const usageByCompany = new Map<string, number>();
  for (const d of companyUsers.docs) {
    if (["ACTIVE", "INVITED"].includes(d.data().status)) {
      const cid = d.data().companyId as string;
      usageByCompany.set(cid, (usageByCompany.get(cid) ?? 0) + 1);
    }
  }
  const seatsByPlanMap = new Map<
    string,
    { companies: number; seatsAllowed: number; seatsUsed: number }
  >();
  for (const s of seatEligible) {
    const e = seatsByPlanMap.get(s.plan) ?? { companies: 0, seatsAllowed: 0, seatsUsed: 0 };
    e.companies += 1;
    e.seatsAllowed += s.seats;
    e.seatsUsed += usageByCompany.get(s.companyId) ?? 0;
    seatsByPlanMap.set(s.plan, e);
  }

  const subscriptions: PlatformMetrics["subscriptions"] = {
    ...(Object.fromEntries(
      SUBSCRIPTION_STATUSES.map((status) => [status, statusCount.get(status) ?? 0]),
    ) as Record<string, number>),
    total: subs.length,
  };

  const valued = subs.filter((s) => ["ACTIVE", "PAST_DUE"].includes(s.status));
  const currency = valued[0]?.currency ?? "CAD";
  const contractedMonthlyCents = valued
    .filter((s) => s.currency === currency && s.priceCents)
    .reduce(
      (sum, s) =>
        sum + Math.round((s.priceCents ?? 0) / (CYCLE_MONTHS[s.billingCycle as BillingCycle] ?? 1)),
      0,
    );

  return {
    companies: {
      total: companies.length,
      active: companies.length - readOnly,
      readOnly,
      newInPeriod,
    },
    subscriptions,
    users: {
      total: users.size,
      active: usersWithActiveMembership.size,
      platformAdmins,
    },
    trialsEndingSoon,
    needsAttention,
    seatsByPlan: [...seatsByPlanMap.entries()]
      .map(([plan, e]) => ({ plan, ...e }))
      .sort((a, b) => b.companies - a.companies),
    growth: growthByMonth(companies, subs),
    contractedMonthlyCents,
    currency,
  };
}

function growthByMonth(
  companies: Company[],
  subs: Subscription[],
): { month: string; companies: number; subscriptions: number }[] {
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - 11, 1);
  from.setUTCHours(0, 0, 0, 0);

  const months: { month: string; companies: number; subscriptions: number }[] = [];
  const cursor = new Date(from);
  for (let i = 0; i < 12; i++) {
    months.push({ month: cursor.toISOString().slice(0, 7), companies: 0, subscriptions: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const byMonth = new Map(months.map((e) => [e.month, e]));

  for (const c of companies) {
    if (c.createdAt < from) continue;
    const b = byMonth.get(c.createdAt.toISOString().slice(0, 7));
    if (b) b.companies += 1;
  }
  for (const s of subs) {
    if (s.createdAt < from) continue;
    const b = byMonth.get(s.createdAt.toISOString().slice(0, 7));
    if (b) b.subscriptions += 1;
  }
  return months;
}
