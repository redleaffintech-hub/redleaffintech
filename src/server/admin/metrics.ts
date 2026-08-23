/**
 * Platform-level metrics for the admin dashboard.
 *
 * Everything here counts *businesses and subscriptions*. Nothing reads a
 * client's ledger: a platform administrator has no business seeing what any
 * company invoiced this month, and the dashboard is the most tempting place to
 * blur that line. Revenue figures below are contracted subscription value from
 * the subscription rows themselves, never anything from a customer's books.
 */

import "server-only";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { CYCLE_MONTHS, type BillingCycle } from "@/lib/plans";
import { SUBSCRIPTION_STATUSES } from "@/lib/subscriptions";

export interface DashboardRange {
  /** Days back the "new in period" figures cover. */
  days: number;
}

export const RANGE_OPTIONS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last 12 months" },
];

/** Trials inside this window are "ending soon" and worth a call. */
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

export async function platformMetrics(range: DashboardRange = { days: 30 }): Promise<PlatformMetrics> {
  const since = addDays(new Date(), -range.days);
  const soon = addDays(new Date(), TRIAL_SOON_DAYS);

  const [
    totalCompanies,
    readOnlyCompanies,
    newCompanies,
    statusGroups,
    totalUsers,
    activeUsers,
    platformAdmins,
    trialsEndingSoon,
    needsAttention,
    seatRows,
    subscriptionValues,
  ] = await Promise.all([
    db.company.count(),
    db.company.count({ where: { isReadOnly: true } }),
    db.company.count({ where: { createdAt: { gte: since } } }),
    db.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    db.user.count(),
    // "Active" means somebody who actually holds live access to a company —
    // a user row with no active membership is an account, not a customer.
    db.user.count({ where: { companyUsers: { some: { status: "ACTIVE" } } } }),
    db.user.count({ where: { isPlatformAdmin: true, platformAdminSuspendedAt: null } }),
    db.subscription.findMany({
      where: { status: "TRIALING", trialEndsAt: { not: null, lte: soon } },
      orderBy: { trialEndsAt: "asc" },
      take: 10,
      select: {
        id: true,
        companyId: true,
        plan: true,
        trialEndsAt: true,
        company: { select: { name: true } },
      },
    }),
    db.subscription.findMany({
      where: { status: { in: ["PAST_DUE", "SUSPENDED"] } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        companyId: true,
        plan: true,
        status: true,
        pastDueSince: true,
        suspendedAt: true,
        company: { select: { name: true } },
      },
    }),
    db.subscription.findMany({
      where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
      select: { plan: true, seats: true, companyId: true },
    }),
    db.subscription.findMany({
      where: { status: { in: ["ACTIVE", "PAST_DUE"] } },
      select: { priceCents: true, billingCycle: true, currency: true },
    }),
  ]);

  // One query for seat usage across every company, rather than one per plan.
  const usageRows = await db.companyUser.groupBy({
    by: ["companyId"],
    where: {
      status: { in: ["ACTIVE", "INVITED"] },
      companyId: { in: seatRows.map((row) => row.companyId) },
    },
    _count: { _all: true },
  });
  const usageByCompany = new Map(usageRows.map((row) => [row.companyId, row._count._all]));

  const seatsByPlan = new Map<string, { companies: number; seatsAllowed: number; seatsUsed: number }>();
  for (const row of seatRows) {
    const entry = seatsByPlan.get(row.plan) ?? { companies: 0, seatsAllowed: 0, seatsUsed: 0 };
    entry.companies += 1;
    entry.seatsAllowed += row.seats;
    entry.seatsUsed += usageByCompany.get(row.companyId) ?? 0;
    seatsByPlan.set(row.plan, entry);
  }

  const subscriptions: PlatformMetrics["subscriptions"] = {
    ...(Object.fromEntries(
      SUBSCRIPTION_STATUSES.map((status) => [
        status,
        statusGroups.find((group) => group.status === status)?._count._all ?? 0,
      ]),
    ) as Record<string, number>),
    total: statusGroups.reduce((sum, group) => sum + group._count._all, 0),
  };

  // Contracted value, normalised to a monthly figure so three cycles can sit in
  // one number. Mixed currencies would make this meaningless, so it is reported
  // in the majority currency and only sums matching rows.
  const currency = subscriptionValues[0]?.currency ?? "CAD";
  const contractedMonthlyCents = subscriptionValues
    .filter((row) => row.currency === currency && row.priceCents)
    .reduce(
      (sum, row) =>
        sum + Math.round((row.priceCents ?? 0) / (CYCLE_MONTHS[row.billingCycle as BillingCycle] ?? 1)),
      0,
    );

  return {
    companies: {
      total: totalCompanies,
      active: totalCompanies - readOnlyCompanies,
      readOnly: readOnlyCompanies,
      newInPeriod: newCompanies,
    },
    subscriptions,
    users: { total: totalUsers, active: activeUsers, platformAdmins },
    trialsEndingSoon: trialsEndingSoon.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      companyName: row.company.name,
      plan: row.plan,
      trialEndsAt: row.trialEndsAt,
    })),
    needsAttention: needsAttention.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      companyName: row.company.name,
      plan: row.plan,
      status: row.status,
      since: row.status === "SUSPENDED" ? row.suspendedAt : row.pastDueSince,
    })),
    seatsByPlan: [...seatsByPlan.entries()]
      .map(([plan, entry]) => ({ plan, ...entry }))
      .sort((a, b) => b.companies - a.companies),
    growth: await growthByMonth(),
    contractedMonthlyCents,
    currency,
  };
}

/**
 * Twelve months of client and subscription starts.
 *
 * Grouped in JavaScript rather than SQL: the row counts here are in the
 * hundreds, and a `date_trunc` group-by would tie this to PostgreSQL for no
 * measurable gain at this size.
 */
async function growthByMonth(): Promise<{ month: string; companies: number; subscriptions: number }[]> {
  const from = new Date();
  from.setUTCMonth(from.getUTCMonth() - 11, 1);
  from.setUTCHours(0, 0, 0, 0);

  const [companies, subscriptions] = await Promise.all([
    db.company.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
    db.subscription.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
  ]);

  const months: { month: string; companies: number; subscriptions: number }[] = [];
  const cursor = new Date(from);
  for (let index = 0; index < 12; index += 1) {
    months.push({ month: cursor.toISOString().slice(0, 7), companies: 0, subscriptions: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const byMonth = new Map(months.map((entry) => [entry.month, entry]));

  for (const row of companies) {
    const bucket = byMonth.get(row.createdAt.toISOString().slice(0, 7));
    if (bucket) bucket.companies += 1;
  }
  for (const row of subscriptions) {
    const bucket = byMonth.get(row.createdAt.toISOString().slice(0, 7));
    if (bucket) bucket.subscriptions += 1;
  }

  return months;
}
