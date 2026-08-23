import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { listUsers } from "@/server/admin/users";
import { formatDate, relativeTime } from "@/lib/dates";
import { ROLE_LABELS, type CompanyRole } from "@/lib/enums";
import { Badge, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, EmptyRow, Pagination } from "@/components/admin/ui";
import { adminInputClass } from "@/components/admin/forms";
import type { AdminSearchParams } from "@/lib/admin-constants";

export const metadata = { title: "Users" };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function UsersPage({ searchParams }: { searchParams: AdminSearchParams }) {
  await requirePlatformAdmin();
  const params = await searchParams;

  const q = first(params.q) ?? "";
  const page = Number(first(params.page) ?? 1) || 1;
  const platformAdminsOnly = first(params.admins) === "1";

  const { rows, total, pageCount } = await listUsers({ q, page, platformAdminsOnly });

  return (
    <>
      <AdminPageHeader
        title="Users"
        description="Everyone with an account, and the client companies they belong to."
        actions={
          <Link
            href="/admin/users/new"
            className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
          >
            Create user
          </Link>
        }
      />

      <AdminCard className="mb-4">
        <form method="get" className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Name or email"
            aria-label="Search users"
            className={`${adminInputClass} max-w-sm flex-1`}
          />
          <label className="flex items-center gap-2 text-[0.8125rem] text-ink-800">
            <input
              type="checkbox"
              name="admins"
              value="1"
              defaultChecked={platformAdminsOnly}
              className="h-4 w-4 rounded border-paper-400"
            />
            Platform administrators only
          </label>
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-lg bg-ink-950 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-ink-900"
          >
            Search
          </button>
          {(q || platformAdminsOnly) && (
            <Link href="/admin/users" className="text-[0.8125rem] font-medium text-brand-700 hover:underline">
              Clear
            </Link>
          )}
        </form>
      </AdminCard>

      <AdminCard>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Companies</Th>
              <Th>Flags</Th>
              <Th>Last signed in</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>No users match that search.</EmptyRow>
            ) : (
              rows.map((user) => {
                const active = user.companyUsers.filter((membership) => membership.status === "ACTIVE");
                return (
                  <Tr key={user.id}>
                    <Td>
                      <Link
                        href={`/admin/users/${user.id}`}
                        className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                      >
                        {user.name}
                      </Link>
                    </Td>
                    <Td>{user.email}</Td>
                    <Td>
                      {active.length === 0 ? (
                        <span className="text-[0.75rem] text-muted-ink">None</span>
                      ) : (
                        <span className="text-[0.75rem]">
                          {active
                            .slice(0, 2)
                            .map(
                              (membership) =>
                                `${membership.company.name} (${ROLE_LABELS[membership.role as CompanyRole] ?? membership.role})`,
                            )
                            .join(", ")}
                          {active.length > 2 && ` +${active.length - 2}`}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {user.isPlatformAdmin && (
                          <Badge tone={user.platformAdminSuspendedAt ? "negative" : "accent"}>
                            {user.platformAdminSuspendedAt ? "admin suspended" : "platform admin"}
                          </Badge>
                        )}
                        {user.mfaEnabled && <Badge tone="positive">mfa</Badge>}
                        {user.mustChangePassword && <Badge tone="caution">must reset</Badge>}
                      </span>
                    </Td>
                    <Td>
                      {user.lastLoginAt ? (
                        <span title={formatDate(user.lastLoginAt)}>{relativeTime(user.lastLoginAt)}</span>
                      ) : (
                        <span className="text-muted-ink">Never</span>
                      )}
                    </Td>
                    <Td>{formatDate(user.createdAt)}</Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </Table>
      </AdminCard>

      <div className="mt-4">
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          basePath="/admin/users"
          params={{ q, admins: platformAdminsOnly ? "1" : undefined }}
        />
      </div>
    </>
  );
}
