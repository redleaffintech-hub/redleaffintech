import { requirePlatformAdmin } from "@/server/admin/guard";
import { LOGIN_LIMITS } from "@/server/admin/rate-limit";
import { STEP_UP_WINDOW_MINUTES } from "@/server/admin/session";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, relativeTime } from "@/lib/dates";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { Badge, Callout } from "@/components/ui";
import { AdminCard, AdminPageHeader, DefinitionRow } from "@/components/admin/ui";
import { AdminField, AdminForm, adminInputClass, ConfirmAction, SubmitButton } from "@/components/admin/forms";
import { MfaPanel } from "./mfa-panel";
import { changeOwnPasswordAction, signOutEverywhereAction } from "./actions";

export const metadata = { title: "Settings" };

/**
 * The operator's own account and the console's security posture.
 *
 * Deliberately about *you*, not about the platform's configuration: plans live
 * under Plans, clients under Clients. What is left is the pair of things an
 * administrator is personally responsible for — their credential and their
 * sessions.
 */
export default async function SettingsPage() {
  const actor = await requirePlatformAdmin();

  const [me, sessions] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: {
        name: true,
        email: true,
        mfaEnabled: true,
        mfaEnrolledAt: true,
        passwordChangedAt: true,
        platformAdminSince: true,
        lastLoginAt: true,
      },
    }),
    db.session.findMany({
      where: { userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, scope: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true },
    }),
  ]);

  return (
    <>
      <AdminPageHeader
        title="Settings"
        description="Your platform administrator account, and how this console treats sessions."
      />

      {!me.mfaEnabled && (
        <div className="mb-4">
          <Callout tone="caution" title="Two-factor authentication is not enabled">
            You can suspend a client company, cancel a subscription and change what every visitor is charged. A
            password on its own is not enough protection for that.
          </Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="space-y-5">
          <MfaPanel
            csrfToken={actor.csrfToken}
            enabled={me.mfaEnabled}
            enrolledAt={me.mfaEnrolledAt ? formatDate(me.mfaEnrolledAt) : null}
          />

          <AdminCard title="Password" subtitle={me.passwordChangedAt ? `Last changed ${formatDate(me.passwordChangedAt)}` : "Never changed"}>
            <AdminForm action={changeOwnPasswordAction} csrfToken={actor.csrfToken}>
              <input type="hidden" name="email" value={me.email} autoComplete="username" readOnly />
              <div className="grid gap-4 sm:grid-cols-2">
                <AdminField label="Current password" required htmlFor="settings-current">
                  <input
                    id="settings-current"
                    name="currentPassword"
                    type="password"
                    required
                    autoComplete="current-password"
                    className={adminInputClass}
                  />
                </AdminField>
                <div />
                <AdminField
                  label="New password"
                  required
                  htmlFor="settings-new"
                  hint={`At least ${MIN_PASSWORD_LENGTH} characters, mixing at least three character classes.`}
                >
                  <input
                    id="settings-new"
                    name="newPassword"
                    type="password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    className={adminInputClass}
                  />
                </AdminField>
                <AdminField label="Confirm new password" required htmlFor="settings-confirm">
                  <input
                    id="settings-confirm"
                    name="confirmPassword"
                    type="password"
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    className={adminInputClass}
                  />
                </AdminField>
              </div>
              <div className="mt-4">
                <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
              </div>
            </AdminForm>
          </AdminCard>

          <AdminCard title="Your sessions" subtitle={`${sessions.length} active`}>
            <ul className="divide-y divide-paper-200">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink-900">
                      <Badge tone={session.scope === "ADMIN" ? "accent" : "neutral"}>
                        {session.scope === "ADMIN" ? "console" : "app"}
                      </Badge>
                      {session.ipAddress ?? "unknown address"}
                    </p>
                    <p className="mt-0.5 truncate text-[0.75rem] text-muted-ink" title={session.userAgent ?? undefined}>
                      {session.userAgent ?? "Unknown device"}
                    </p>
                  </div>
                  <span className="shrink-0 text-[0.75rem] text-muted-ink">
                    {formatDateTime(session.createdAt)}
                    {session.lastSeenAt ? ` · seen ${relativeTime(session.lastSeenAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-paper-200 pt-4">
              <ConfirmAction
                action={signOutEverywhereAction}
                csrfToken={actor.csrfToken}
                label="Sign out everywhere"
                title="End all of your sessions?"
                description="Every session, including this one, on every device. You will be asked to sign in again immediately."
                confirmLabel="Sign out everywhere"
              />
            </div>
          </AdminCard>
        </div>

        <div className="space-y-5">
          <AdminCard title="Account">
            <dl>
              <DefinitionRow label="Name" value={me.name} />
              <DefinitionRow label="Email" value={me.email} />
              <DefinitionRow
                label="Administrator since"
                value={me.platformAdminSince ? formatDate(me.platformAdminSince) : "—"}
              />
              <DefinitionRow
                label="Last signed in"
                value={me.lastLoginAt ? relativeTime(me.lastLoginAt) : "—"}
              />
            </dl>
            <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
              Your name and email are edited from your{" "}
              <a href={`/admin/users/${actor.id}`} className="font-medium text-brand-700 hover:underline">
                user record
              </a>
              .
            </p>
          </AdminCard>

          <AdminCard title="How this console is protected">
            <ul className="space-y-2.5 text-[0.75rem] leading-5 text-ink-700">
              <li>
                <span className="font-medium text-ink-900">Separate sessions.</span> The console uses its own cookie
                and its own session scope. Signing in to the accounting app never grants access here.
              </li>
              <li>
                <span className="font-medium text-ink-900">Short-lived.</span> Twelve hours absolute, one hour idle.
              </li>
              <li>
                <span className="font-medium text-ink-900">Rate limited.</span> {LOGIN_LIMITS.maxPerEmail} failures
                against one address, or {LOGIN_LIMITS.maxDistinctEmailsPerIp} different addresses from one IP, locks
                sign-in for {LOGIN_LIMITS.windowMinutes} minutes.
              </li>
              <li>
                <span className="font-medium text-ink-900">Step-up.</span> Changing who can reach this console needs
                your authenticator code, or your password if you have none — valid for {STEP_UP_WINDOW_MINUTES}{" "}
                minutes.
              </li>
              <li>
                <span className="font-medium text-ink-900">Recorded.</span> Every action lands in the admin audit log
                with your name, the time and the address you acted from.
              </li>
            </ul>
          </AdminCard>
        </div>
      </div>
    </>
  );
}
