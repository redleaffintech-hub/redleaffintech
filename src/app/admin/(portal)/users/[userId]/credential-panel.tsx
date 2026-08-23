"use client";

import { useState } from "react";
import { ConfirmAction } from "@/components/admin/forms";
import { OneTimeSecret } from "@/components/admin/ui";
import { forceSignOutAction, resetPasswordAction } from "../actions";

/**
 * Recovering an account, without ever seeing inside it.
 *
 * There is no "show password" here and there never can be — the column holds a
 * bcrypt hash and nothing in the product reverses it. What an administrator can
 * do is issue a *new* way in, and both routes invalidate every outstanding token
 * and every live session, so a reset genuinely takes the account back from
 * whoever had it.
 *
 * The result is rendered once, in this component's state. It is not in the page
 * data, so a refresh loses it — which is the correct behaviour for something
 * that only ever existed to be copied.
 */
export function CredentialPanel({
  csrfToken,
  userId,
  userName,
  userEmail,
  activeSessions,
}: {
  csrfToken: string;
  userId: string;
  userName: string;
  userEmail: string;
  activeSessions: number;
}) {
  const [issued, setIssued] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {issued && <OneTimeSecret label="Issued once" value={issued} />}

      <div>
        <p className="text-[0.8125rem] leading-6 text-ink-800">
          Nobody — including you — can read <strong>{userName}</strong>&rsquo;s current password. A reset issues a new
          way in and signs them out everywhere.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <ConfirmAction
            action={resetPasswordAction}
            csrfToken={csrfToken}
            label="Issue reset link"
            tone="secondary"
            title="Issue a password reset link?"
            description={
              <>
                A single-use token for <strong>{userEmail}</strong>, valid for 24 hours. It is shown once here so you
                can pass it on — only its hash is stored. Every existing session is signed out.
              </>
            }
            confirmLabel="Issue reset link"
            reasonRequired
            reasonLabel="Why is this being reset?"
            hidden={{ userId, method: "LINK" }}
            onSuccess={(message) => setIssued(message ?? null)}
          />

          <ConfirmAction
            action={resetPasswordAction}
            csrfToken={csrfToken}
            label="Issue temporary password"
            tone="secondary"
            title="Issue a temporary password?"
            description={
              <>
                Replaces <strong>{userEmail}</strong>&rsquo;s password with a generated one, shown once here, which
                they must change at first sign-in. Use this only when handing the account over directly. Every
                existing session is signed out.
              </>
            }
            confirmLabel="Issue temporary password"
            reasonRequired
            reasonLabel="Why is this being reset?"
            hidden={{ userId, method: "TEMPORARY" }}
            onSuccess={(message) => setIssued(message ?? null)}
          />
        </div>
      </div>

      <div className="border-t border-[color:var(--color-negative)]/20 pt-4">
        <p className="text-[0.8125rem] leading-6 text-ink-800">
          {activeSessions === 0
            ? "They have no active sessions."
            : `They have ${activeSessions} active session${activeSessions === 1 ? "" : "s"} across the app and this console.`}
        </p>
        <div className="mt-3">
          <ConfirmAction
            action={forceSignOutAction}
            csrfToken={csrfToken}
            label="Sign out everywhere"
            title="End every session for this account?"
            description={
              <>
                <strong>{userName}</strong> will be signed out of the accounting app and the platform console on every
                device. Their password is unchanged, so they can sign straight back in.
              </>
            }
            confirmLabel="Sign out everywhere"
            reasonRequired={false}
            hidden={{ userId }}
          />
        </div>
      </div>
    </div>
  );
}
