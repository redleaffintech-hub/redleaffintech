"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { loginAction } from "./actions";
import { Button, Field, inputClass } from "@/components/ui";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    const result = await loginAction(formData);
    if (result?.error) setError(result.error);
  }

  return (
    <>
      <form action={onSubmit} className="mt-7 space-y-4">
        <Field label="Work email" required>
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="you@company.ca"
          />
        </Field>

        <Field
          label="Password"
          required
          action={
            <Link href="/contact?topic=password" className="text-[0.75rem] font-medium text-brand-700 hover:underline">
              Forgot password?
            </Link>
          }
        >
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </Field>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}

        <SubmitButton />
      </form>

    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending} className="h-9 w-full">
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}
