import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { getUserForAdmin } from "@/server/admin/users";
import { STEP_UP_WINDOW_MINUTES } from "@/server/admin/session";
import { getUser } from "@/server/db/users";
import { listMembershipsForCompany } from "@/server/db/company-users";
import { formatDate, formatDateTime, relativeTime } from "@/lib/dates";
import { Badge } from "@/components/ui";
import { AdminCard, AdminPageHeader, DangerZone, DefinitionRow } from "@/components/admin/ui";
import { UserMemberships } from "./memberships";
import { CredentialPanel } from "./credential-panel";
import { PlatformAccessPanel } from "./platform-access-panel";
import { ProfileForm } from "./profile-form";
import type { AdminParams } from "@/lib/admin-constants";

export async function generateMetadata({ params }: { params: AdminParams<"userId"> }) {
  const { userId } = await params;
  const user = await getUser(userId);
  return { title: user?.name ?? "User" };
}

/**
 * One person, across every company they belong to.
 *
 * The session list shows device and address but never a token; the credentials
 * panel can issue a new way in but can never reveal the current one. Both are
 * deliberate: an administrator's job here is to restore access, not to acquire
 * it.
 */
export default async function UserDetailPage({ params }: { params: AdminParams<"userId"> }) {
  const actor = await requirePlatformAdmin();
  const { userId } = await params;

  const user = await getUserForAdmin(userId);
  if (!user) notFound();

  // Which of their memberships is the last active PRIMARY of its company — the
  // ones the service layer will refuse to remove.
  const primariesByCompany = new Map<string, number>();
  await Promise.all(
    user.companyUsers.map(async (membership) => {
      const members = await listMembershipsForCompany(membership.company.id);
      primariesByCompany.set(
        membership.company.id,
        members.filter((m) => m.role === "PRIMARY" && m.status === "ACTIVE").length,
      );
    }),
  );

  const memberships = user.companyUsers.map((membership) => ({
    id: membership.id,
    role: membership.role,
    status: membership.status,
    companyId: membership.company.id,
    companyName: membership.company.name,
    subscriptionStatus: membership.company.subscription?.status ?? null,
    plan: membership.company.subscription?.plan ?? null,
    isOnlyActivePrimary:
      membership.role === "PRIMARY" &&
      membership.status === "ACTIVE" &&
      (primariesByCompany.get(membership.company.id) ?? 0) <= 1,
  }));

  const isSelf = actor.id === user.id;

  return (
    <>
      <AdminPageHeader
        title={user.name}
        description={user.email}
        breadcrumb={[{ label: "Users", href: "/admin/users" }, { label: user.name }]}
        actions={
          <>
            {user.isPlatformAdmin && (
              <Badge tone={user.platformAdminSuspendedAt ? "negative" : "accent"}>
                {user.platformAdminSuspendedAt ? "admin suspended" : "platform admin"}
              </Badge>
            )}
            {user.mfaEnabled && <Badge tone="positive">mfa enrolled</Badge>}
            {user.mustChangePassword && <Badge tone="caution">must change password</Badge>}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="space-y-5">
          <ProfileForm
            csrfToken={actor.csrfToken}
            userId={user.id}
            name={user.name}
            email={user.email}
          />

          <UserMemberships csrfToken={actor.csrfToken} userId={user.id} memberships={memberships} />

          <DangerZone title="Credentials and sessions">
            <CredentialPanel
              csrfToken={actor.csrfToken}
              userId={user.id}
              userName={user.name}
              userEmail={user.email}
              activeSessions={user.sessions.length}
            />
          </DangerZone>

          <PlatformAccessPanel
            csrfToken={actor.csrfToken}
            userId={user.id}
            userName={user.name}
            userEmail={user.email}
            isPlatformAdmin={user.isPlatformAdmin}
            isSuspended={Boolean(user.platformAdminSuspendedAt)}
            isSelf={isSelf}
            actorMfaEnabled={actor.mfaEnabled}
            actorRecentlyVerified={actor.recentlyVerified}
            stepUpWindowMinutes={STEP_UP_WINDOW_MINUTES}
          />
        </div>

        <div className="space-y-5">
          <AdminCard title="Account">
            <dl>
              <DefinitionRow label="Created" value={formatDate(user.createdAt)} />
              <DefinitionRow
                label="Last signed in"
                value={user.lastLoginAt ? relativeTime(user.lastLoginAt) : "Never"}
              />
              <DefinitionRow
                label="Password changed"
                value={user.passwordChangedAt ? formatDate(user.passwordChangedAt) : "—"}
              />
              <DefinitionRow label="MFA" value={user.mfaEnabled ? "Enrolled" : "Not enrolled"} />
              <DefinitionRow
                label="Platform admin since"
                value={user.platformAdminSince ? formatDate(user.platformAdminSince) : "—"}
              />
            </dl>
          </AdminCard>

          <AdminCard title="Active sessions" subtitle="Device and address only — never a token">
            {user.sessions.length === 0 ? (
              <p className="py-4 text-center text-[0.8125rem] text-muted-ink">No active sessions.</p>
            ) : (
              <ul className="divide-y divide-paper-200">
                {user.sessions.map((session) => (
                  <li key={session.id} className="py-2.5">
                    <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink-900">
                      <Badge tone={session.scope === "ADMIN" ? "accent" : "neutral"}>
                        {session.scope === "ADMIN" ? "console" : "app"}
                      </Badge>
                      {session.ipAddress ?? "unknown address"}
                    </p>
                    <p className="mt-0.5 truncate text-[0.75rem] text-muted-ink" title={session.userAgent ?? undefined}>
                      {session.userAgent ?? "Unknown device"}
                    </p>
                    <p className="text-[0.75rem] text-muted-ink">
                      Started {formatDateTime(session.createdAt)}
                      {session.lastSeenAt ? ` · last seen ${relativeTime(session.lastSeenAt)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          <AdminCard title="Audit">
            <Link
              href={`/admin/audit?entityId=${user.id}`}
              className="text-[0.8125rem] font-medium text-brand-700 hover:underline"
            >
              Everything the platform has done to this account
            </Link>
          </AdminCard>
        </div>
      </div>
    </>
  );
}
