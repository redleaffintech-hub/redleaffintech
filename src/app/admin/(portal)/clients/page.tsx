import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { CLIENT_SORTS, listClients, type ClientSort } from "@/server/admin/clients";
import { sellablePlans } from "@/server/plans/catalogue";
import { SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { formatDate } from "@/lib/dates";
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

export const metadata = { title: "Clients" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The book of business.
 *
 * The filter bar is a plain GET form on purpose: the resulting URL is the state,
 * so a support conversation can be handed over as a link, and the browser's back
 * button behaves. No client-side JavaScript is involved in searching at all.
 */
export default async function ClientsPage({ searchParams }: { searchParams: AdminSearchParams }) {
  await requirePlatformAdmin();
  const params = await searchParams;

  const q = first(params.q) ?? "";
  const plan = first(params.plan) ?? "";
  const status = first(params.status) ?? "";
  const sortParam = first(params.sort) ?? "created";
  const sort: ClientSort = (Object.keys(CLIENT_SORTS) as ClientSort[]).includes(sortParam as ClientSort)
    ? (sortParam as ClientSort)
    : "created";
  const page = Number(first(params.page) ?? 1) || 1;

  const [{ rows, total, pageCount }, plans] = await Promise.all([
    listClients({ q, plan, status, sort, page }),
    sellablePlans(),
  ]);

  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries({ q, plan, status, sort })) {
    if (value) exportQuery.set(key, value);
  }

  return (
    <>
      <AdminPageHeader
        title="Clients"
        description="Every company file on the platform, and the subscription behind it."
        actions={
          <>
            <Link
              href={`/admin/clients/export?${exportQuery.toString()}`}
              className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
            >
              Export CSV
            </Link>
            <Link
              href="/admin/clients/new"
              className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
            >
              Create client
            </Link>
          </>
        }
      />

      <AdminCard className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_12rem_auto]">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Company, legal name, email or a person"
            aria-label="Search clients"
            className={adminInputClass}
          />
          <select name="plan" defaultValue={plan} aria-label="Plan" className={adminInputClass}>
            <option value="">Any plan</option>
            {plans.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} aria-label="Subscription status" className={adminInputClass}>
            <option value="">Any status</option>
            {SUBSCRIPTION_STATUSES.map((option) => (
              <option key={option} value={option}>
                {SUBSCRIPTION_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
          <select name="sort" defaultValue={sort} aria-label="Sort" className={adminInputClass}>
            {Object.entries(CLIENT_SORTS).map(([key, option]) => (
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
            {(q || plan || status || sort !== "created") && (
              <Link href="/admin/clients" className="text-[0.8125rem] font-medium text-brand-700 hover:underline">
                Clear
              </Link>
            )}
          </div>
        </form>
      </AdminCard>

      {/* Table renders its own -mx-5/px-5 scroll gutter, which is sized for a
          card with 1.25rem padding — AdminCard is exactly that. */}
      <AdminCard>
        <Table>
          <thead>
            <tr>
              <Th>Company</Th>
              <Th>Primary user</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              <Th align="right">Seats</Th>
              <Th>Trial ends</Th>
              <Th>Renews</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={8}>
                No clients match that search.{" "}
                <Link href="/admin/clients/new" className="font-medium text-brand-700 hover:underline">
                  Create one
                </Link>
                .
              </EmptyRow>
            ) : (
              rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link
                      href={`/admin/clients/${row.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="block text-[0.75rem] text-muted-ink">
                      {row.province}
                      {row.country !== "CA" ? ` · ${row.country}` : ""} · {row.baseCurrency}
                      {row.isReadOnly && " · read-only"}
                    </span>
                  </Td>
                  <Td>
                    {row.primaryUser ? (
                      <>
                        <Link
                          href={`/admin/users/${row.primaryUser.id}`}
                          className="text-ink-900 hover:text-brand-700 hover:underline"
                        >
                          {row.primaryUser.name}
                        </Link>
                        <span className="block text-[0.75rem] text-muted-ink">{row.primaryUser.email}</span>
                      </>
                    ) : (
                      <span className="text-[0.75rem] text-negative">No primary user</span>
                    )}
                  </Td>
                  <Td>{row.subscription?.plan ?? <span className="text-muted-ink">—</span>}</Td>
                  <Td>
                    {row.subscription ? (
                      <SubscriptionStatusBadge status={row.subscription.status} />
                    ) : (
                      <span className="text-[0.75rem] text-muted-ink">No subscription</span>
                    )}
                  </Td>
                  <Td align="right">
                    {row.subscription ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular-nums">
                          {row.userCount} / {row.subscription.seats}
                        </span>
                        {row.subscription.seatsOverridden && <OverrideTag />}
                      </span>
                    ) : (
                      <span className="tabular-nums">{row.userCount}</span>
                    )}
                  </Td>
                  <Td>{row.subscription?.trialEndsAt ? formatDate(row.subscription.trialEndsAt) : "—"}</Td>
                  <Td>{row.subscription?.currentPeriodEnd ? formatDate(row.subscription.currentPeriodEnd) : "—"}</Td>
                  <Td>{formatDate(row.createdAt)}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </AdminCard>

      <div className="mt-4">
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          basePath="/admin/clients"
          params={{ q, plan, status, sort }}
        />
      </div>
    </>
  );
}
