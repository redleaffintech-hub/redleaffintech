"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { changePasswordAction } from "./actions";
import { Button, Field, inputClass } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

export function PasswordForm() {
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    const result = await changePasswordAction(formData);
    if (result?.error) setError(result.error);
  }

  return (
    <form action={onSubmit} className="mt-6 space-y-4">
      <Field label="Current password" required>
        <PasswordInput name="currentPassword" autoComplete="current-password" required className={inputClass} />
      </Field>
      <Field label="New password" required hint="At least 12 characters, mixing three of: lower case, upper case, digits, symbols.">
        <PasswordInput name="newPassword" autoComplete="new-password" required className={inputClass} />
      </Field>
      <Field label="Confirm new password" required>
        <PasswordInput name="confirmPassword" autoComplete="new-password" required className={inputClass} />
      </Field>
      {error && (
        <p role="alert" className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending} className="w-full">
      {pending ? "Saving…" : "Update password"}
    </Button>
  );
}
