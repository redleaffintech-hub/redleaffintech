"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import clsx from "clsx";
import { Icon } from "./icons";
import { useOutsideClick } from "./use-outside-click";
import { CommandPalette } from "./command-palette";
import { CompanyLogoModal } from "@/components/company-logo-modal";
import { logoutAction, switchCompanyAction } from "@/app/actions/session";
import { ROLE_LABELS, type CompanyRole } from "@/lib/enums";

export interface TopbarNotification {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  link: string | null;
}

export function Topbar({
  user,
  companyName,
  companyLogoUrl,
  province,
  role,
  memberships,
  notifications,
  periodLabel,
  ledgerHealthy,
}: {
  user: { name: string; email: string };
  companyName: string;
  companyLogoUrl: string | null;
  province: string;
  role: CompanyRole;
  memberships: { companyId: string; companyName: string; role: CompanyRole }[];
  notifications: TopbarNotification[];
  periodLabel: string;
  ledgerHealthy: boolean;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-4 lg:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2" aria-label="Red Leaf Accounting — dashboard">
          <Image src="/brand/mark.png" alt="" width={34} height={29} className="h-[1.65rem] w-auto" priority />
          <span className="hidden text-[0.875rem] font-semibold tracking-[-0.01em] text-ink-950 xl:inline">
            Red&nbsp;Leaf Accounting
          </span>
        </Link>

        <span aria-hidden className="hidden h-6 w-px bg-paper-300 sm:block" />

        <CompanySwitcher
          companyName={companyName}
          companyLogoUrl={companyLogoUrl}
          province={province}
          role={role}
          memberships={memberships}
        />

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="group flex h-9 flex-1 max-w-md items-center gap-2 rounded-lg border border-paper-300 bg-paper-100 px-3 text-left text-[0.8125rem] text-ink-400 transition-colors hover:border-paper-400 hover:bg-white"
        >
          <Icon name="search" className="h-4 w-4 text-ink-400" />
          <span className="flex-1 truncate">Search invoices, customers, accounts…</span>
          <kbd className="hidden rounded border border-paper-400 bg-white px-1.5 py-0.5 font-sans text-[0.6875rem] text-muted-ink sm:inline">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span
            className={clsx(
              "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75rem] font-medium md:inline-flex",
              ledgerHealthy
                ? "border-[color:var(--color-positive)]/25 bg-positive-soft text-positive"
                : "border-[color:var(--color-negative)]/25 bg-negative-soft text-negative",
            )}
            title={
              ledgerHealthy
                ? "Debits equal credits and the accounting equation holds."
                : "The ledger is out of balance — open Trial Balance to investigate."
            }
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", ledgerHealthy ? "bg-positive" : "bg-negative")} />
            {ledgerHealthy ? "Ledger balanced" : "Ledger exception"}
          </span>

          <span className="hidden rounded-full border border-paper-300 bg-paper-100 px-2.5 py-1 text-[0.75rem] text-ink-700 lg:inline">
            {periodLabel}
          </span>

          <NotificationBell notifications={notifications} />
          <UserMenu user={user} role={role} companyLogoUrl={companyLogoUrl} />
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}

function CompanySwitcher({
  companyName,
  companyLogoUrl,
  province,
  role,
  memberships,
}: {
  companyName: string;
  companyLogoUrl: string | null;
  province: string;
  role: CompanyRole;
  memberships: { companyId: string; companyName: string; role: CompanyRole }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useOutsideClick(() => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-lg border border-paper-300 bg-white px-2.5 text-[0.8125rem] font-medium text-ink-900 transition-colors hover:border-ink-300"
      >
        {companyLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimizable remote asset
          <img src={companyLogoUrl} alt="" className="h-6 w-6 rounded object-contain" />
        ) : (
          <span className="grid h-6 w-6 place-items-center rounded bg-ink-900 text-[0.6875rem] font-semibold text-white">
            {companyName.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-[13rem] truncate sm:inline">{companyName}</span>
        <span className="hidden text-[0.75rem] font-normal text-muted-ink lg:inline">· {province}</span>
        <Icon name="chevronDown" className="h-3.5 w-3.5 text-ink-400" />
      </button>

      {open && (
        <div className="rise absolute left-0 top-11 z-40 w-80 overflow-hidden rounded-xl border border-paper-300 bg-white shadow-[0_16px_48px_-12px_rgba(10,16,32,0.25)]">
          <p className="border-b border-paper-200 px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
            Your companies
          </p>
          <ul className="max-h-80 overflow-y-auto py-1">
            {memberships.map((membership) => {
              const active = membership.companyName === companyName;
              return (
                <li key={membership.companyId}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => startTransition(() => switchCompanyAction(membership.companyId))}
                    className={clsx(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[0.8125rem] transition-colors hover:bg-paper-100",
                      active && "bg-brand-soft",
                    )}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-ink-900 text-[0.6875rem] font-semibold text-white">
                      {membership.companyName.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink-900">{membership.companyName}</span>
                      <span className="block text-[0.75rem] text-muted-ink">{ROLE_LABELS[membership.role]}</span>
                    </span>
                    {active && <Icon name="check" className="h-4 w-4 text-brand-600" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-paper-200 px-3 py-2 text-[0.75rem] text-muted-ink">
            Signed in as <span className="font-medium text-ink-700">{ROLE_LABELS[role]}</span> here.
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationBell({ notifications }: { notifications: TopbarNotification[] }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick(() => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications (${notifications.length} unread)`}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-paper-300 bg-white text-ink-700 transition-colors hover:border-ink-300"
      >
        <Icon name="bell" />
        {notifications.length > 0 && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-maple-500 ring-2 ring-white" />
        )}
      </button>

      {open && (
        <div className="rise absolute right-0 top-11 z-40 w-96 overflow-hidden rounded-xl border border-paper-300 bg-white shadow-[0_16px_48px_-12px_rgba(10,16,32,0.25)]">
          <p className="border-b border-paper-200 px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
            Alerts
          </p>
          {notifications.length === 0 ? (
            <p className="px-3 py-6 text-center text-[0.8125rem] text-muted-ink">Nothing needs your attention.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id} className="border-b border-paper-100 last:border-0">
                  <Link
                    href={n.link ?? "#"}
                    onClick={() => setOpen(false)}
                    className="flex gap-2.5 px-3 py-2.5 transition-colors hover:bg-paper-100"
                  >
                    <span
                      className={clsx(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        n.severity === "CRITICAL" ? "bg-negative" : n.severity === "WARNING" ? "bg-caution" : "bg-info",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block text-[0.8125rem] font-medium text-ink-900">{n.title}</span>
                      {n.body && <span className="block text-[0.75rem] leading-5 text-muted-ink">{n.body}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu({
  user,
  role,
  companyLogoUrl,
}: {
  user: { name: string; email: string };
  role: CompanyRole;
  companyLogoUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [logoModalOpen, setLogoModalOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useOutsideClick(() => setOpen(false));
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid h-9 w-9 place-items-center rounded-full bg-ink-900 text-[0.75rem] font-semibold text-white transition-transform hover:scale-105"
        aria-label="Account menu"
      >
        {initials}
      </button>

      {open && (
        <div className="rise absolute right-0 top-11 z-40 w-64 overflow-hidden rounded-xl border border-paper-300 bg-white shadow-[0_16px_48px_-12px_rgba(10,16,32,0.25)]">
          <div className="border-b border-paper-200 px-3 py-3">
            <p className="text-[0.8125rem] font-semibold text-ink-900">{user.name}</p>
            <p className="truncate text-[0.75rem] text-muted-ink">{user.email}</p>
            <p className="mt-1.5 inline-flex rounded-full bg-paper-200 px-2 py-0.5 text-[0.6875rem] font-medium text-ink-700">
              {ROLE_LABELS[role]}
            </p>
          </div>
          <Link href="/company" onClick={() => setOpen(false)} className="block px-3 py-2 text-[0.8125rem] text-ink-800 hover:bg-paper-100">
            Company settings
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setLogoModalOpen(true);
            }}
            className="block w-full px-3 py-2 text-left text-[0.8125rem] text-ink-800 hover:bg-paper-100"
          >
            Company logo
          </button>
          <Link href="/company/audit" onClick={() => setOpen(false)} className="block px-3 py-2 text-[0.8125rem] text-ink-800 hover:bg-paper-100">
            Audit log
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => logoutAction())}
            className="flex w-full items-center gap-2 border-t border-paper-200 px-3 py-2 text-left text-[0.8125rem] text-ink-800 hover:bg-paper-100"
          >
            <Icon name="logout" className="h-4 w-4 text-ink-400" />
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}

      {logoModalOpen && (
        <CompanyLogoModal onClose={() => setLogoModalOpen(false)} currentLogoUrl={companyLogoUrl} />
      )}
    </div>
  );
}

