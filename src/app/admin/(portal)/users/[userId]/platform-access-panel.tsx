"use client";

import Link from "next/link";
import { ConfirmAction } from "@/components/admin/forms";
import { DangerZone } from "@/components/admin/ui";
import { StepUpFields } from "@/components/admin/step-up";
import {
  promoteExistingUserAction,
  removeAdministratorAction,
  suspendAdministratorAction,
} from "../../administrators/actions";

/**
 * Granting or withdrawing console access, from the person's own page.
 *
 * Every control carries the step-up fields: a live session is not sufficient
 * authority to hand somebody the keys to every client on the platform. The
 * server checks the same thing again — these fields exist so the operator is
 * asked for the right credential, not so the check happens on the client.
 */
export function PlatformAccessPanel({
  csrfToken,
  userId,
  userName,
  userEmail,
  isPlatformAdmin,
  isSuspended,
  isSelf,
  actorMfaEnabled,
  actorRecentlyVerified,
  stepUpWindowMinutes,
}: {
  csrfToken: string;
  userId: string;
  userName: string;
  userEmail: string;
  isPlatformAdmin: boolean;
  isSuspended: boolean;
  isSelf: boolean;
  actorMfaEnabled: boolean;
  actorRecentlyVerified: boolean;
  stepUpWindowMinutes: number;
}) {
  const stepUp = (
    <StepUpFields
      mfaEnabled={actorMfaEnabled}
      recentlyVerified={actorRecentlyVerified}
      windowMinutes={stepUpWindowMinutes}
    />
  );

  return (
    <DangerZone title="Platform administrator access">
      <p className="text-[0.8125rem] leading-6 text-ink-800">
        A platform administrator can see and change every client, plan and subscription on this installation. It is
        the widest privilege the product has.{" "}
        <Link href="/admin/administrators" className="font-medium text-brand-700 hover:underline">
          See everyone who holds it
        </Link>
        .
      </p>

      {isSelf && (
        <p className="rounded-md border border-[color:var(--color-caution)]/30 bg-caution-soft px-3 py-2 text-[0.75rem] leading-5 text-ink-800">
          This is your own account. You cannot suspend or remove your own platform access — ask a colleague, so that
          two people know the console changed hands.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!isPlatformAdmin || isSuspended ? (
          <ConfirmAction
            action={promoteExistingUserAction}
            csrfToken={csrfToken}
            label={isSuspended ? "Reinstate platform access" : "Grant platform access"}
            title={isSuspended ? "Reinstate this administrator?" : "Grant platform administrator access?"}
            description={
              <>
                <strong>{userName}</strong> ({userEmail}) will be able to sign in at <code>/admin</code> and manage
                every client, plan and subscription on the platform.
              </>
            }
            confirmLabel={isSuspended ? "Reinstate access" : "Grant access"}
            tone="secondary"
            reasonRequired
            reasonLabel="Why do they need platform access?"
            hidden={{ userId }}
            extraFields={stepUp}
          />
        ) : (
          <>
            <ConfirmAction
              action={suspendAdministratorAction}
              csrfToken={csrfToken}
              label="Suspend platform access"
              title="Suspend this administrator?"
              description={
                <>
                  <strong>{userName}</strong> keeps their account and their client companies, but loses the console
                  immediately — including any session they have open right now. This is reversible.
                </>
              }
              confirmLabel="Suspend access"
              reasonRequired
              hidden={{ userId }}
              extraFields={stepUp}
              disabled={isSelf}
              disabledReason="You cannot suspend your own platform access."
            />

            <ConfirmAction
              action={removeAdministratorAction}
              csrfToken={csrfToken}
              label="Remove platform access"
              title="Remove platform administrator access?"
              description={
                <>
                  <strong>{userName}</strong> stops being a platform administrator altogether. Their user account and
                  company memberships are untouched, and any MFA they enrolled stays with them.
                </>
              }
              confirmLabel="Remove access"
              reasonRequired
              hidden={{ userId }}
              extraFields={stepUp}
              disabled={isSelf}
              disabledReason="You cannot remove your own platform access."
            />
          </>
        )}
      </div>
    </DangerZone>
  );
}
