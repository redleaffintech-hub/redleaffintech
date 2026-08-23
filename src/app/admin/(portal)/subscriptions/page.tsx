import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { db } from "@/lib/db";
import { sellablePlans } from "@/server/plans/catalogue";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { CYCLE_LABELS, type BillingCycle } from "@/lib/plans";
import { ATTENTION_STATUSES, SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { Table, Td, Th, Tr } from "@/components/ui";
import {
  AdminCard,
  AdminPageHeader,
  EmptyRow,
  OverrideTag,
  Pagination,
  SubscriptionStatusBadge,
} from "@/components/admin/ui";
import { adminInputClass } from "@/components/admin/forms";
import type { AdminSearchParams } from "@/lib/admin-constants";

export const metadata = { title: "Subscriptions" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const PER_PAGE = 25;

const SORTS = {
  updated: { label: "Recently changed", orderBy: { updatedAt: "desc" } },
  trial: { label: "Trial ending soonest", orderBy: { trialEndsAt: "asc" } },
  renewal: { label: "Renewing soonest", orderBy: { currentPeriodEnd: "asc" } },
  created: { label: "Newest first", orderBy: { createdAt: "desc" } },
} as const;

type Sort = keyof typeof SORTS;

export default async function SubscriptionsPage({ searchParams }: { searchParams: AdminSearchParams }) {
  await requirePlatformAdmin();
  const params = await searchParams;

  const q = first(params.q) ?? "";
  const status = first(params.status) ?? "";
  const plan = first(params.plan) ?? "";
  const attention = first(params.attention) === "1";
  const sortParam = (first(params.sort) ?? "updated") as Sort;
  const sort: Sort = sortParam in SORTS ? sortParam : "updated";
  const page = Math.max(Number(first(params.page) ?? 1) || 1, 1);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (attention) where.status = { in: ATTENTION_STATUSES };
  if (plan) where.plan = plan;
  if (q) where.company = { name: { contains: q, mode: "insensitive" } };

  const [total, rows, plans, seatCounts] = await Promise.all([
    db.subscription.count({ where }),
    db.subscription.findMany({
      where,
      orderBy: SORTS[sort].orderBy as never,
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        companyId: true,
        plan: true,
        status: true,
        billingCycle: true,
        currency: true,
        priceCents: true,
        seats: true,
        seatsOverridden: true,
        trialEndsAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAt: true,
        providerRef: true,
        startedAt: true,
        company: { select: { name: true } },
      },
    }),
    sellablePlans(),
    db.companyUser.groupBy({
      by: ["companyId"],
      where: { status: { in: ["ACTIVE", "INVITED"] } },
      _count: { _all: true },
    }),
  ]);

  const usage = new Map(seatCounts.map((row) => [row.companyId, row._count._all]));

  return (
    <>
      <AdminPageHeader
        title="Subscriptions"
        description="What every client is on, and where each one stands commercially."
      />

      <AdminCard className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_11rem_12rem_auto]">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Company name"
            aria-label="Search by company"
            className={adminInputClass}
          />
          <select name="status" defaultValue={status} aria-label="Status" className={adminInputClass}>
            <option value="">Any status</option>
            {SUBSCRIPTION_STATUSES.map((option) => (
              <option key={option} value={option}>
                {SUBSCRIPTION_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
          <select name="plan" defaultValue={plan} aria-label="Plan" className={adminInputClass}>
            <option value="">Any plan</option>
            {plans.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
          <select name="sort" defaultValue={sort} aria-label="Sort" className={adminInputClass}>
            {Object.entries(SORTS).map(([key, option]) => (
              <option key={key} value={key}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-lg bg-ink-950 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-ink-900"
            >
              Filter
            </button>
            {(q || status || plan || attention || sort !== "updated") && (
              <Link href="/admin/subscriptions" className="text-[0.8125rem] font-medium text-brand-700 hover:underline">
                Clear
              </Link>
            )}
          </div>
        </form>
        {attention && (
          <p className="mt-3 text-[0.75rem] text-caution">
            Showing only subscriptions that need attention — past due or suspended.
          </p>
        )}
      </AdminCard>

      <AdminCard>
        <Table>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Plan</Th>
              <Th>Cycle</Th>
              <Th>Status</Th>
              <Th align="right">Seats</Th>
              <Th align="right">Price</Th>
              <Th>Trial ends</Th>
              <Th>Period</Th>
              <Th>Provider ref</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={9}>No subscriptions match that filter.</EmptyRow>
            ) : (
              rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link
                      href={`/admin/subscriptions/${row.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {row.company.name}
                    </Link>
                    {row.cancelAt && (
                      <span className="block text-[0.75rem] text-negative">
                        cancels {formatDate(row.cancelAt)}
                      </span>
                    )}
                  </Td>
                  <Td>{row.plan}</Td>
                  <Td>{CYCLE_LABELS[row.billingCycle as BillingCycle] ?? row.billingCycle}</Td>
                  <Td>
                    <SubscriptionStatusBadge status={row.status} />
                  </Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="tabular-nums">
                        {usage.get(row.companyId) ?? 0} / {row.seats}
                      </span>
                      {row.seatsOverridden && <OverrideTag />}
                    </span>
                  </Td>
                  <Td align="right">
                    {row.priceCents != null ? (
                      <span className="tabular-nums">
                        {formatMoney(row.priceCents, { currency: row.currency })}
                      </span>
                    ) : (
                      <span className="text-muted-ink">—</span>
                    )}
                  </Td>
                  <Td>{row.trialEndsAt ? formatDate(row.trialEndsAt) : "—"}</Td>
                  <Td>
                    {row.currentPeriodEnd ? (
                      <span className="text-[0.75rem]">
                        {row.currentPeriodStart ? `${formatDate(row.currentPeriodStart)} – ` : ""}
                        {formatDate(row.currentPeriodEnd)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    {row.providerRef ? (
                      <span className="font-mono text-[0.75rem]">{row.providerRef}</span>
                    ) : (
                      <span className="text-muted-ink">—</span>
                    )}
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </AdminCard>

      <div className="mt-4">
        <Pagination
          page={page}
          pageCount={Math.max(1, Math.ceil(total / PER_PAGE))}
          total={total}
          basePath="/admin/subscriptions"
          params={{ q, status, plan, sort, attention: attention ? "1" : undefined }}
        />
      </div>
    </>
  );
}
