"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { loginAction } from "./actions";
import { Button, Field, inputClass } from "@/components/ui";
import { ROLE_LABELS, type CompanyRole } from "@/lib/enums";

export interface DemoAccount {
  email: string;
  name: string;
  description: string;
  role: CompanyRole;
}

export function LoginForm({ demoAccounts }: { demoAccounts: DemoAccount[] }) {
  const [email, setEmail] = useState(demoAccounts[0]?.email ?? "");
  const [password, setPassword] = useState(demoAccounts.length > 0 ? "demo1234" : "");
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

      {demoAccounts.length > 0 && (
      <div className="mt-8">
        <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
          Demo accounts — password <span className="font-mono normal-case tracking-normal">demo1234</span>
        </p>
        <ul className="divide-y divide-paper-200 overflow-hidden rounded-lg border border-paper-300">
          {demoAccounts.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                onClick={() => {
                  setEmail(account.email);
                  setPassword("demo1234");
                  setError(null);
                }}
                className={clsx(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-paper-100",
                  email === account.email && "bg-brand-soft",
                )}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-900 text-[0.6875rem] font-semibold text-white">
                  {account.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-medium text-ink-900">{account.name}</span>
                  <span className="block truncate text-[0.75rem] text-muted-ink">{account.description}</span>
                </span>
                <span className="shrink-0 rounded-full bg-paper-200 px-2 py-0.5 text-[0.6875rem] font-medium text-ink-700">
                  {ROLE_LABELS[account.role]}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
          Each role sees a different product: the bookkeeper cannot close a period, the reviewer can approve
          but not originate, and the accountant works across both client companies.
        </p>
      </div>
      )}
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
