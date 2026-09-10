import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { subscriptions as subscriptionsRepo } from "@/server/db/platform";
import { listAllCompanies } from "@/server/db/companies";
import { listMembershipsForCompany } from "@/server/db/company-users";
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
  updated: { label: "Recently changed", field: "updatedAt" as const, dir: "desc" as const },
  trial: { label: "Trial ending soonest", field: "trialEndsAt" as const, dir: "asc" as const },
  renewal: { label: "Renewing soonest", field: "currentPeriodEnd" as const, dir: "asc" as const },
  created: { label: "Newest first", field: "createdAt" as const, dir: "desc" as const },
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

  const qLc = q.toLowerCase();
  const [allSubs, plans, companies] = await Promise.all([
    subscriptionsRepo.list(),
    sellablePlans(),
    listAllCompanies(),
  ]);
  const companyById = new Map(companies.map((c) => [c.id, c]));

  const filtered = allSubs
    .filter((s) => {
      if (attention) return ATTENTION_STATUSES.includes(s.status as never);
      return !status || s.status === status;
    })
    .filter((s) => !plan || s.plan === plan)
    .filter((s) => !q || (companyById.get(s.companyId)?.name ?? "").toLowerCase().includes(qLc));

  const { field, dir } = SORTS[sort];
  filtered.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[field];
    const bv = (b as unknown as Record<string, unknown>)[field];
    const at = av instanceof Date ? av.getTime() : av == null ? (dir === "asc" ? Infinity : -Infinity) : 0;
    const bt = bv instanceof Date ? bv.getTime() : bv == null ? (dir === "asc" ? Infinity : -Infinity) : 0;
    return dir === "asc" ? at - bt : bt - at;
  });

  const total = filtered.length;
  const rawRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const usage = new Map<string, number>();
  await Promise.all(
    [...new Set(rawRows.map((r) => r.companyId))].map(async (cid) => {
      const members = await listMembershipsForCompany(cid);
      usage.set(cid, members.filter((m) => ["ACTIVE", "INVITED"].includes(m.status)).length);
    }),
  );

  const rows = rawRows.map((s) => ({
    ...s,
    company: { name: companyById.get(s.companyId)?.name ?? "—" },
  }));

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
