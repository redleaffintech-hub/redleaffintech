import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { listAdministrators } from "@/server/admin/administrators";
import { recentAdminFailures, LOGIN_LIMITS } from "@/server/admin/rate-limit";
import { STEP_UP_WINDOW_MINUTES } from "@/server/admin/session";
import { formatDate, formatDateTime, relativeTime } from "@/lib/dates";
import { Badge, Callout, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, EmptyRow } from "@/components/admin/ui";
import { InviteAdministratorForm } from "./invite-form";
import { AdministratorRowActions } from "./row-actions";

export const metadata = { title: "Platform administrators" };

/**
 * Who can reach this console.
 *
 * The failed-sign-in panel is here rather than buried in the audit log because
 * this is the page somebody opens when they suspect something is wrong, and a
 * run of failures against a real administrator's address is the first thing they
 * should see.
 */
export default async function AdministratorsPage() {
  const actor = await requirePlatformAdmin();

  const [administrators, failures] = await Promise.all([listAdministrators(), recentAdminFailures(12)]);

  const active = administrators.filter((admin) => !admin.platformAdminSuspendedAt);
  const withoutMfa = active.filter((admin) => !admin.mfaEnabled);

  return (
    <>
      <AdminPageHeader
        title="Platform administrators"
        description="Accounts that can sign in to this console and manage every client on the platform."
      />

      {withoutMfa.length > 0 && (
        <div className="mb-4">
          <Callout tone="caution" title="Two-factor authentication is not universal">
            {withoutMfa.length} of {active.length} active administrator{active.length === 1 ? "" : "s"} have no
            authenticator enrolled ({withoutMfa.map((admin) => admin.email).join(", ")}). Without it, a stolen
            password is enough to reach every client&rsquo;s account.{" "}
            <Link href="/admin/settings" className="font-medium underline">
              Enrol yours
            </Link>
            .
          </Callout>
        </div>
      )}

      <AdminCard className="mb-5">
        <Table>
          <thead>
            <tr>
              <Th>Administrator</Th>
              <Th>Status</Th>
              <Th>MFA</Th>
              <Th>Admin since</Th>
              <Th>Last signed in</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {administrators.length === 0 ? (
              <EmptyRow colSpan={6}>
                No platform administrators exist. Create the first with{" "}
                <code className="font-mono text-[0.75rem]">npm run admin:create</code>.
              </EmptyRow>
            ) : (
              administrators.map((admin) => (
                <Tr key={admin.id}>
                  <Td>
                    <Link
                      href={`/admin/users/${admin.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {admin.name}
                    </Link>
                    <span className="block text-[0.75rem] text-muted-ink">
                      {admin.email}
                      {admin.id === actor.id && " · you"}
                    </span>
                  </Td>
                  <Td>
                    {admin.platformAdminSuspendedAt ? (
                      <Badge tone="negative">suspended</Badge>
                    ) : (
                      <Badge tone="positive">active</Badge>
                    )}
                    {admin.mustChangePassword && (
                      <Badge tone="caution" className="ml-1">
                        must reset
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    {admin.mfaEnabled ? (
                      <span className="text-positive">Enrolled</span>
                    ) : (
                      <span className="text-caution">Not enrolled</span>
                    )}
                  </Td>
                  <Td>{admin.platformAdminSince ? formatDate(admin.platformAdminSince) : "—"}</Td>
                  <Td>{admin.lastLoginAt ? relativeTime(admin.lastLoginAt) : "Never"}</Td>
                  <Td align="right">
                    <AdministratorRowActions
                      csrfToken={actor.csrfToken}
                      userId={admin.id}
                      userName={admin.name}
                      userEmail={admin.email}
                      isSuspended={Boolean(admin.platformAdminSuspendedAt)}
                      isSelf={admin.id === actor.id}
                      isLastActive={active.length <= 1 && !admin.platformAdminSuspendedAt}
                      actorMfaEnabled={actor.mfaEnabled}
                      actorRecentlyVerified={actor.recentlyVerified}
                      stepUpWindowMinutes={STEP_UP_WINDOW_MINUTES}
                    />
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </AdminCard>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <InviteAdministratorForm
          csrfToken={actor.csrfToken}
          actorMfaEnabled={actor.mfaEnabled}
          actorRecentlyVerified={actor.recentlyVerified}
          stepUpWindowMinutes={STEP_UP_WINDOW_MINUTES}
        />

        <AdminCard
          title="Recent failed sign-ins"
          subtitle={`Attempts against this console. ${LOGIN_LIMITS.maxPerEmail} failures locks an address for ${LOGIN_LIMITS.windowMinutes} minutes.`}
        >
          {failures.length === 0 ? (
            <p className="py-6 text-center text-[0.8125rem] text-muted-ink">
              No failed sign-in attempts on record.
            </p>
          ) : (
            <ul className="divide-y divide-paper-200">
              {failures.map((failure) => (
                <li key={failure.id} className="flex items-baseline justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[0.8125rem] text-ink-900">{failure.email}</p>
                    <p className="text-[0.75rem] text-muted-ink">
                      {failure.ipAddress ?? "unknown address"} · {formatDateTime(failure.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[0.6875rem] uppercase tracking-[0.04em] text-muted-ink">
                    {(failure.outcome ?? "failed").replace(/_/g, " ").toLowerCase()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
      </div>
    </>
  );
}
