"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { adminLoginAction } from "./actions";
import { AdminField, adminInputClass, FormError } from "@/components/admin/forms";

/**
 * Sign-in is a two-step form that looks like one.
 *
 * The password is submitted first; if the account has an authenticator enrolled
 * the action comes back asking for a code, and the same form grows a field
 * rather than navigating. Keeping it on one page means a wrong code does not
 * cost the operator their password entry, and there is no half-authenticated
 * state parked in a cookie between the two steps — the session is created only
 * once both factors have been satisfied in a single request.
 */
export function AdminLoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);

  async function onSubmit(formData: FormData) {
    setError(null);
    const result = await adminLoginAction(formData);
    if (result?.mfaRequired) setMfaRequired(true);
    if (result?.error) setError(result.error);
  }

  return (
    <form action={onSubmit} className="mt-6 space-y-4">
      <AdminField label="Work email" required htmlFor="admin-email">
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          readOnly={mfaRequired}
          className={adminInputClass}
          placeholder="you@redleaffintech.com"
        />
      </AdminField>

      <AdminField label="Password" required htmlFor="admin-password">
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          readOnly={mfaRequired}
          className={adminInputClass}
          placeholder="••••••••"
        />
      </AdminField>

      {mfaRequired && (
        <AdminField
          label="Authenticator code"
          required
          htmlFor="admin-code"
          hint="The six-digit code from the app you enrolled."
        >
          <input
            id="admin-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            autoFocus
            className={`${adminInputClass} font-mono tracking-[0.3em]`}
            placeholder="000000"
          />
        </AdminField>
      )}

      {error && <FormError>{error}</FormError>}

      <LoginButton mfaRequired={mfaRequired} />

      <p className="text-[0.75rem] leading-5 text-muted-ink">
        Sessions last 12 hours and end after an hour of inactivity. Repeated failed attempts lock sign-in
        temporarily.
      </p>
    </form>
  );
}

function LoginButton({ mfaRequired }: { mfaRequired: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-ink-950 px-3.5 text-[0.8125rem] font-medium text-white transition-colors hover:bg-ink-900 disabled:cursor-not-allowed disabled:bg-ink-500"
    >
      {pending ? "Checking…" : mfaRequired ? "Verify and sign in" : "Sign in"}
    </button>
  );
}
