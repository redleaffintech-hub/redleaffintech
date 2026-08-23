import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { platformMetrics, RANGE_OPTIONS } from "@/server/admin/metrics";
import { formatDate, daysBetween, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { AdminCard, AdminPageHeader, StatTile, SubscriptionStatusBadge } from "@/components/admin/ui";
import { GrowthChart } from "@/components/admin/growth-chart";
import type { AdminSearchParams } from "@/lib/admin-constants";

export const metadata = { title: "Dashboard" };

const QUICK_LINKS = [
  { label: "Create client", href: "/admin/clients/new", blurb: "Provision a company, its primary user and a subscription" },
  { label: "Create user", href: "/admin/users/new", blurb: "Add a person and invite them into a company" },
  { label: "Assign subscription", href: "/admin/subscriptions", blurb: "Put a client on a plan, or change the one they are on" },
  { label: "Manage plans", href: "/admin/plans", blurb: "Edit the catalogue the public pricing page sells" },
  { label: "Expiring trials", href: "/admin/subscriptions?status=TRIALING&sort=trial", blurb: "Trials ending in the next few days" },
  { label: "Needs attention", href: "/admin/subscriptions?attention=1", blurb: "Past due and suspended accounts" },
];

/**
 * The platform dashboard.
 *
 * Everything here is about the *business of selling the product* — how many
 * clients there are, what state their subscriptions are in, which trials are
 * about to lapse. There is deliberately not a single figure from any client's
 * ledger: being a platform administrator is not a licence to read a customer's
 * books, and a dashboard that quietly showed their revenue would make it one.
 */
export default async function AdminDashboardPage({ searchParams }: { searchParams: AdminSearchParams }) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const rawDays = Number(Array.isArray(params.days) ? params.days[0] : params.days);
  const days = RANGE_OPTIONS.some((option) => option.days === rawDays) ? rawDays : 30;

  const metrics = await platformMetrics({ days });
  const rangeLabel = RANGE_OPTIONS.find((option) => option.days === days)!.label.toLowerCase();

  return (
    <>
      <AdminPageHeader
        title="Platform dashboard"
        description="Red Leaf's book of business: clients, subscriptions and the accounts that need a human."
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {RANGE_OPTIONS.map((option) => (
              <Link
                key={option.days}
                href={`/admin?days=${option.days}`}
                aria-current={option.days === days ? "true" : undefined}
                className={
                  option.days === days
                    ? "rounded-md bg-ink-950 px-2.5 py-1.5 text-[0.75rem] font-medium text-white"
                    : "rounded-md border border-paper-400 bg-white px-2.5 py-1.5 text-[0.75rem] font-medium text-ink-700 hover:bg-paper-100"
                }
              >
                {option.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Client companies"
          value={metrics.companies.total}
          hint={`${metrics.companies.active} writable · ${metrics.companies.readOnly} read-only`}
          href="/admin/clients"
        />
        <StatTile
          label={`New clients (${rangeLabel})`}
          value={metrics.companies.newInPeriod}
          hint="Companies provisioned in the selected period"
          href="/admin/clients?sort=created"
        />
        <StatTile
          label="Active users"
          value={metrics.users.active}
          hint={`${metrics.users.total} accounts in total · ${metrics.users.platformAdmins} platform admin${
            metrics.users.platformAdmins === 1 ? "" : "s"
          }`}
          href="/admin/users"
        />
        <StatTile
          label="Contracted monthly"
          value={formatMoney(metrics.contractedMonthlyCents, { currency: metrics.currency })}
          hint="Active and past-due subscriptions, normalised to a monthly figure"
          href="/admin/subscriptions?status=ACTIVE"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Trialing"
          value={metrics.subscriptions.TRIALING ?? 0}
          tone="info"
          href="/admin/subscriptions?status=TRIALING"
        />
        <StatTile
          label="Active"
          value={metrics.subscriptions.ACTIVE ?? 0}
          tone="positive"
          href="/admin/subscriptions?status=ACTIVE"
        />
        <StatTile
          label="Past due"
          value={metrics.subscriptions.PAST_DUE ?? 0}
          tone={(metrics.subscriptions.PAST_DUE ?? 0) > 0 ? "caution" : "neutral"}
          href="/admin/subscriptions?status=PAST_DUE"
        />
        <StatTile
          label="Suspended"
          value={metrics.subscriptions.SUSPENDED ?? 0}
          tone={(metrics.subscriptions.SUSPENDED ?? 0) > 0 ? "negative" : "neutral"}
          href="/admin/subscriptions?status=SUSPENDED"
        />
        <StatTile
          label="Cancelled"
          value={metrics.subscriptions.CANCELLED ?? 0}
          href="/admin/subscriptions?status=CANCELLED"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <AdminCard
          title="Trials ending soon"
          subtitle="Within the next 7 days"
          actions={
            <Link
              href="/admin/subscriptions?status=TRIALING&sort=trial"
              className="text-[0.75rem] font-medium text-brand-700 hover:underline"
            >
              See all
            </Link>
          }
        >
          {metrics.trialsEndingSoon.length === 0 ? (
            <p className="py-6 text-center text-[0.8125rem] text-muted-ink">No trials end in the next week.</p>
          ) : (
            <ul className="divide-y divide-paper-200">
              {metrics.trialsEndingSoon.map((trial) => {
                const daysLeft = trial.trialEndsAt ? daysBetween(today(), trial.trialEndsAt) : null;
                return (
                  <li key={trial.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/clients/${trial.companyId}`}
                        className="block truncate text-[0.8125rem] font-medium text-ink-900 hover:text-brand-700 hover:underline"
                      >
                        {trial.companyName}
                      </Link>
                      <p className="text-[0.75rem] text-muted-ink">{trial.plan}</p>
                    </div>
                    <span
                      className={
                        daysLeft !== null && daysLeft <= 2
                          ? "shrink-0 text-[0.75rem] font-medium text-negative"
                          : "shrink-0 text-[0.75rem] text-ink-700"
                      }
                    >
                      {daysLeft === null
                        ? "—"
                        : daysLeft <= 0
                          ? "ended"
                          : `${daysLeft}d · ${formatDate(trial.trialEndsAt)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminCard>

        <AdminCard
          title="Needs attention"
          subtitle="Past due or suspended"
          actions={
            <Link href="/admin/subscriptions?attention=1" className="text-[0.75rem] font-medium text-brand-700 hover:underline">
              See all
            </Link>
          }
        >
          {metrics.needsAttention.length === 0 ? (
            <p className="py-6 text-center text-[0.8125rem] text-muted-ink">
              Every subscription is in good standing.
            </p>
          ) : (
            <ul className="divide-y divide-paper-200">
              {metrics.needsAttention.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/subscriptions/${row.id}`}
                      className="block truncate text-[0.8125rem] font-medium text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {row.companyName}
                    </Link>
                    <p className="text-[0.75rem] text-muted-ink">
                      {row.plan}
                      {row.since ? ` · since ${formatDate(row.since)}` : ""}
                    </p>
                  </div>
                  <SubscriptionStatusBadge status={row.status} />
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_22rem]">
        <GrowthChart data={metrics.growth} />

        <AdminCard title="Seat usage by plan" subtitle="Live subscriptions only">
          {metrics.seatsByPlan.length === 0 ? (
            <p className="py-6 text-center text-[0.8125rem] text-muted-ink">No live subscriptions yet.</p>
          ) : (
            <ul className="space-y-3.5">
              {metrics.seatsByPlan.map((row) => {
                const pct = row.seatsAllowed > 0 ? Math.min(100, (row.seatsUsed / row.seatsAllowed) * 100) : 0;
                return (
                  <li key={row.plan}>
                    <div className="flex items-baseline justify-between gap-2 text-[0.8125rem]">
                      <span className="font-medium text-ink-900">{row.plan}</span>
                      <span className="tabular-nums text-muted-ink">
                        {row.seatsUsed} / {row.seatsAllowed}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper-300">
                      <div
                        className={pct >= 90 ? "h-full bg-caution" : "h-full bg-brand-500"}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[0.6875rem] text-muted-ink">
                      {row.companies} compan{row.companies === 1 ? "y" : "ies"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminCard>
      </div>

      <AdminCard title="Quick actions" className="mt-5">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-paper-300 px-3.5 py-3 transition-colors hover:border-brand-400 hover:bg-brand-soft/40"
            >
              <p className="text-[0.8125rem] font-medium text-ink-900">{link.label}</p>
              <p className="mt-0.5 text-[0.75rem] leading-5 text-muted-ink">{link.blurb}</p>
            </Link>
          ))}
        </div>
      </AdminCard>
    </>
  );
}
