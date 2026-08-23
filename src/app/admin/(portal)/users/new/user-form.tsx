"use client";

import { useState } from "react";
import Link from "next/link";
import { AdminField, AdminForm, adminInputClass, SubmitButton } from "@/components/admin/forms";
import { AdminCard, OneTimeSecret } from "@/components/admin/ui";
import { createUserAction } from "../actions";

/**
 * Creating a person.
 *
 * Two ways in, and the default is the better one: an invitation token lets the
 * user choose their own password, which means no credential ever passes through
 * an administrator's hands. The temporary-password route exists because
 * outbound email is not wired up in this build — it is shown once, hashed
 * immediately, and forces a change at first sign-in.
 *
 * Neither route lets anyone read an existing password. There is nothing to read:
 * the column holds a bcrypt hash and no code path in the product reverses it.
 */
export function NewUserForm({ csrfToken }: { csrfToken: string }) {
  const [method, setMethod] = useState<"INVITE" | "TEMPORARY">("INVITE");
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,32rem)_1fr] lg:items-start">
      <AdminForm
        action={createUserAction}
        csrfToken={csrfToken}
        onSuccess={(message) => setResult(message ?? null)}
      >
        <AdminCard title="Account">
          <div className="space-y-4">
            <AdminField label="Full name" required htmlFor="name">
              <input id="name" name="name" required className={adminInputClass} placeholder="Priya Nair" />
            </AdminField>

            <AdminField
              label="Email"
              required
              htmlFor="email"
              hint="Normalised to lower case. This is the login identifier and must be unique."
            >
              <input
                id="email"
                name="email"
                type="email"
                required
                className={adminInputClass}
                placeholder="priya@company.ca"
              />
            </AdminField>

            <fieldset>
              <legend className="mb-2 text-[0.75rem] font-medium text-ink-800">How they get in</legend>
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 rounded-lg border border-paper-300 px-3 py-2.5 text-[0.8125rem]">
                  <input
                    type="radio"
                    name="method"
                    value="INVITE"
                    checked={method === "INVITE"}
                    onChange={() => setMethod("INVITE")}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="font-medium text-ink-900">Invitation link</span>
                    <span className="block text-[0.75rem] leading-5 text-muted-ink">
                      A single-use token, valid for 72 hours. They choose their own password — nobody else ever knows
                      it.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 rounded-lg border border-paper-300 px-3 py-2.5 text-[0.8125rem]">
                  <input
                    type="radio"
                    name="method"
                    value="TEMPORARY"
                    checked={method === "TEMPORARY"}
                    onChange={() => setMethod("TEMPORARY")}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="font-medium text-ink-900">Temporary password</span>
                    <span className="block text-[0.75rem] leading-5 text-muted-ink">
                      Shown once on this page. Must be changed at first sign-in. Use this when you are handing the
                      account over in person or on a call.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <SubmitButton pendingLabel="Creating…">Create user</SubmitButton>
          </div>
        </AdminCard>
      </AdminForm>

      <div className="space-y-4">
        {result && <OneTimeSecret label="Created" value={result} />}

        <AdminCard title="What happens next">
          <ul className="space-y-2.5 text-[0.8125rem] leading-6 text-ink-700">
            <li>
              The account exists but belongs to no company. Grant access from the{" "}
              <Link href="/admin/clients" className="font-medium text-brand-700 hover:underline">
                client&rsquo;s page
              </Link>{" "}
              or from the user&rsquo;s own, choosing the role they should hold there.
            </li>
            <li>Each grant consumes a seat on that client&rsquo;s subscription. The limit is enforced server-side.</li>
            <li>The same person can belong to several companies with a different role in each — one login, many books.</li>
            <li>
              Everything on this page is recorded in the{" "}
              <Link href="/admin/audit" className="font-medium text-brand-700 hover:underline">
                admin audit log
              </Link>
              , minus the secret itself.
            </li>
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
