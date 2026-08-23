"use client";

import { AdminField, adminInputClass } from "./forms";

/**
 * The re-authentication fields on a high-risk action.
 *
 * Which field appears is decided by what the *acting* administrator has: an
 * authenticator code if they are enrolled, their password if they are not. The
 * server makes the same decision independently — this only saves the operator
 * from being shown a field that would be ignored.
 *
 * When MFA was satisfied recently the fields collapse to a note, because
 * demanding a fresh code for every change in a five-minute run of related edits
 * trains people to keep the authenticator open, which is the opposite of the
 * point.
 */
export function StepUpFields({
  mfaEnabled,
  recentlyVerified,
  windowMinutes,
}: {
  mfaEnabled: boolean;
  recentlyVerified: boolean;
  windowMinutes: number;
}) {
  if (mfaEnabled && recentlyVerified) {
    return (
      <p className="mb-3 rounded-md bg-paper-200 px-3 py-2 text-[0.75rem] leading-5 text-ink-700">
        Your two-factor authentication was confirmed within the last {windowMinutes} minutes, so this change does not
        need it again.
      </p>
    );
  }

  if (mfaEnabled) {
    return (
      <div className="mb-3">
        <AdminField
          label="Authenticator code"
          required
          htmlFor="stepup-code"
          hint="Confirms it is you making this change, not just your browser."
        >
          <input
            id="stepup-code"
            name="totpCode"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoComplete="one-time-code"
            className={`${adminInputClass} max-w-[10rem] font-mono tracking-[0.3em]`}
            placeholder="000000"
          />
        </AdminField>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <AdminField
        label="Confirm your password"
        required
        htmlFor="stepup-password"
        hint="You have no authenticator enrolled, so your password is the confirmation. Enrol MFA in Settings."
      >
        <input
          id="stepup-password"
          name="confirmPassword"
          type="password"
          required
          autoComplete="current-password"
          className={`${adminInputClass} max-w-[18rem]`}
        />
      </AdminField>
    </div>
  );
}
