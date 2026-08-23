"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { ADMIN_NAV } from "@/lib/admin-constants";
import { AdminForm, SubmitButton } from "./forms";
import type { AdminAction } from "./forms";

/**
 * The platform-admin chrome.
 *
 * Deliberately not the accounting app's shell. That one is white paper with a
 * blue accent and a company switcher; this one is dark slate with a standing
 * "Platform" marker and no notion of a current company at all — because there
 * isn't one. An operator glancing at their screen should be able to tell in
 * peripheral vision whether they are inside one client's books or above all of
 * them.
 */
export function AdminShell({
  user,
  csrfToken,
  signOutAction,
  children,
}: {
  user: { name: string; email: string; mfaEnabled: boolean };
  csrfToken: string;
  signOutAction: AdminAction;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper-200">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-8">
          <Link href="/admin" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-md bg-maple-500 text-[0.75rem] font-bold text-white"
            >
              RL
            </span>
            <span className="font-display text-[0.9375rem] font-semibold tracking-[-0.01em] text-white">
              Red Leaf
            </span>
          </Link>

          <span className="rounded-full bg-maple-500/15 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-maple-200 ring-1 ring-inset ring-maple-500/30">
            Platform administration
          </span>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[0.8125rem] font-medium leading-tight text-white">{user.name}</p>
              <p className="text-[0.6875rem] leading-tight text-ink-300">{user.email}</p>
            </div>
            {!user.mfaEnabled && (
              <Link
                href="/admin/settings"
                className="rounded-full bg-caution-soft px-2 py-0.5 text-[0.6875rem] font-medium text-caution"
                title="Two-factor authentication is not enabled on your account"
              >
                MFA off
              </Link>
            )}
            <AdminForm action={signOutAction} csrfToken={csrfToken} className="inline-block">
              <SubmitButton tone="secondary" className="h-8 !border-ink-700 !bg-ink-900 !text-ink-100 hover:!bg-ink-800">
                Sign out
              </SubmitButton>
            </AdminForm>
          </div>
        </div>

        <AdminNav />
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">{children}</main>

      <footer className="border-t border-paper-300 bg-white">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-4 text-[0.75rem] text-muted-ink lg:px-8">
          Platform administration console. Actions here affect Red Leaf&rsquo;s customers — every change is recorded in
          the{" "}
          <Link href="/admin/audit" className="font-medium text-brand-700 hover:underline">
            admin audit log
          </Link>
          .
        </div>
      </footer>
    </div>
  );
}

function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Platform administration" className="border-t border-ink-800/70 bg-ink-900">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap gap-x-1 gap-y-0.5 px-2 lg:px-6">
        {ADMIN_NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.description}
              className={clsx(
                "rounded-t-md px-3 py-2.5 text-[0.8125rem] font-medium transition-colors",
                active
                  ? "bg-paper-200 text-ink-950"
                  : "text-ink-300 hover:bg-ink-800 hover:text-white",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
