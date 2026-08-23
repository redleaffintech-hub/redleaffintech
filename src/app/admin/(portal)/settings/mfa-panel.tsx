"use client";

import { useState } from "react";
import {
  AdminField,
  AdminForm,
  adminInputClass,
  ConfirmAction,
  SubmitButton,
} from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { beginMfaEnrolmentAction, confirmMfaEnrolmentAction, disableMfaAction } from "./actions";

/**
 * Two-factor enrolment.
 *
 * The secret is displayed as text and as an `otpauth://` URI rather than a QR
 * code: rendering a QR would mean either a dependency or an image endpoint that
 * serves the secret, and every authenticator app worth using accepts a pasted
 * URI or a typed key.
 *
 * It is shown exactly once, on this screen, in this component's state. Nothing
 * re-renders it afterwards — the stored copy is AES-GCM ciphertext and the app
 * only ever decrypts it to check a code.
 */
export function MfaPanel({
  csrfToken,
  enabled,
  enrolledAt,
}: {
  csrfToken: string;
  enabled: boolean;
  enrolledAt: string | null;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);

  function receiveSecret(message?: string) {
    if (!message) return;
    // The action packs both halves into one string; see beginMfaEnrolmentAction.
    const [displaySecret, otpauth] = message.split("||");
    setSecret(displaySecret ?? null);
    setUri(otpauth ?? null);
  }

  if (enabled) {
    return (
      <AdminCard title="Two-factor authentication" subtitle={enrolledAt ? `Enrolled ${enrolledAt}` : undefined}>
        <p className="text-[0.8125rem] leading-6 text-ink-800">
          Your authenticator is required at sign-in, and again when you change who can reach this console.
        </p>

        <div className="mt-3">
          <ConfirmAction
            action={disableMfaAction}
            csrfToken={csrfToken}
            label="Turn off two-factor"
            title="Turn off two-factor authentication?"
            description="Your password alone will then be enough to reach every client on the platform. Only do this if you have lost the authenticator and are about to enrol a new one."
            confirmLabel="Turn it off"
            reasonRequired
            reasonLabel="Why?"
            extraFields={
              <div className="mb-3">
                <AdminField label="Confirm your password" required htmlFor="disable-mfa-password">
                  <input
                    id="disable-mfa-password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    className={`${adminInputClass} max-w-[18rem]`}
                  />
                </AdminField>
              </div>
            }
          />
        </div>
      </AdminCard>
    );
  }

  return (
    <AdminCard title="Two-factor authentication" subtitle="Not enrolled">
      <p className="text-[0.8125rem] leading-6 text-ink-800">
        Without it, a stolen password is enough to reach every client, plan and subscription on this installation.
        Enrolling takes about a minute.
      </p>

      {!secret ? (
        <div className="mt-3">
          <AdminForm action={beginMfaEnrolmentAction} csrfToken={csrfToken} onSuccess={receiveSecret}>
            <SubmitButton pendingLabel="Generating…">Set up two-factor</SubmitButton>
          </AdminForm>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-caution/30 bg-caution-soft px-4 py-3">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-caution">
              Shown once — add it to your authenticator now
            </p>
            <p className="mt-2 break-all rounded-md border border-caution/25 bg-white px-3 py-2 font-mono text-[0.9375rem] tracking-[0.15em] text-ink-900">
              {secret}
            </p>
            {uri && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[0.75rem] font-medium text-ink-700">
                  Or paste this URI into your app
                </summary>
                <p className="mt-1.5 break-all rounded-md border border-caution/25 bg-white px-3 py-2 font-mono text-[0.6875rem] text-ink-800">
                  {uri}
                </p>
              </details>
            )}
            <p className="mt-2 text-[0.75rem] leading-5 text-ink-700">
              Compatible with Google Authenticator, 1Password, Authy and anything else that does TOTP.
            </p>
          </div>

          <AdminForm action={confirmMfaEnrolmentAction} csrfToken={csrfToken}>
            <AdminField
              label="Enter the current code"
              required
              htmlFor="confirm-code"
              hint="This proves the secret reached your app before it becomes required."
            >
              <input
                id="confirm-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoComplete="one-time-code"
                className={`${adminInputClass} max-w-[10rem] font-mono tracking-[0.3em]`}
                placeholder="000000"
              />
            </AdminField>
            <div className="mt-3">
              <SubmitButton pendingLabel="Checking…">Turn on two-factor</SubmitButton>
            </div>
          </AdminForm>
        </div>
      )}
    </AdminCard>
  );
}
