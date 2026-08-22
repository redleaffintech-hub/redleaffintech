"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Icon } from "./icons";
import { useOutsideClick } from "./use-outside-click";
import { ACCOUNTANT_GROUP, NAV_GROUPS, type NavGroup, type NavItem } from "./nav-config";
import type { AccessLevel } from "@/lib/permissions";

export interface NavCounts {
  bankQueue: number;
  overdue: number;
  approvals: number;
}

/**
 * The module nav — one horizontal row of products, each opening its screens in
 * a dropdown. It replaced the vertical sidebar so the working area gets the full
 * window width, which the dense accounting tables need more than the nav does.
 *
 * A group with a single screen renders as a plain link rather than a menu of one.
 */
export function MainNav({
  access,
  counts,
  isAccountant,
}: {
  access: Record<string, AccessLevel>;
  counts: NavCounts;
  isAccountant: boolean;
}) {
  const pathname = usePathname();
  // The firm workspace sits directly after Dashboard, where an accountant looks
  // for it first — the same position it held in the sidebar.
  const groups: NavGroup[] = isAccountant
    ? [NAV_GROUPS[0], ACCOUNTANT_GROUP, ...NAV_GROUPS.slice(1)]
    : NAV_GROUPS;

  return (
    <nav aria-label="Modules" className="border-t border-paper-200">
      {/*
        No overflow container here, deliberately. `overflow-x: auto` also clips
        the cross axis, which swallowed the dropdowns entirely. The row wraps to a
        second line on narrow screens instead, which costs nothing: every trigger
        carries its own vertical padding, so a wrapped row is simply taller.
      */}
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-stretch gap-0.5 px-2 lg:px-6">
        {groups.map((group) => (
          <NavGroupMenu
            key={group.label}
            group={group}
            pathname={pathname}
            access={access}
            counts={counts}
          />
        ))}
      </div>
    </nav>
  );
}

function isItemActive(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function NavGroupMenu({
  group,
  pathname,
  access,
  counts,
}: {
  group: NavGroup;
  pathname: string;
  access: Record<string, AccessLevel>;
  counts: NavCounts;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick(() => setOpen(false));

  const visible = group.items.filter(
    (item) => !item.capability || (access[item.capability] ?? "NONE") !== "NONE",
  );
  if (visible.length === 0) return null;

  const active = visible.some((item) => isItemActive(item, pathname));
  const groupCount = visible.reduce((sum, item) => sum + (item.badgeKey ? counts[item.badgeKey] : 0), 0);

  // A group of one is a destination, not a menu.
  if (visible.length === 1) {
    return (
      <Link href={visible[0].href} className={triggerClass(active)}>
        <Icon name={group.icon} className={iconClass(active)} />
        {group.label}
        {groupCount > 0 && <CountPill value={groupCount} />}
      </Link>
    );
  }

  return (
    <div className="relative flex items-stretch" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={triggerClass(active)}
      >
        <Icon name={group.icon} className={iconClass(active)} />
        {group.label}
        {groupCount > 0 && <CountPill value={groupCount} />}
        <Icon name="chevronDown" className={clsx("h-3 w-3 text-ink-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="rise absolute left-0 top-full z-40 min-w-[15rem] overflow-hidden rounded-xl border border-paper-300 bg-white py-1 shadow-[0_16px_48px_-12px_rgba(10,16,32,0.25)]">
          {visible.map((item) => {
            const itemActive = isItemActive(item, pathname);
            const count = item.badgeKey ? counts[item.badgeKey] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  "flex items-center gap-2 px-3 py-2 text-[0.8125rem] transition-colors hover:bg-paper-100",
                  itemActive ? "font-medium text-brand-700" : "text-ink-800",
                )}
              >
                <span className="flex-1">{item.label}</span>
                {count > 0 && <CountPill value={count} />}
                {itemActive && <Icon name="check" className="h-3.5 w-3.5 text-brand-600" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function triggerClass(active: boolean) {
  return clsx(
    "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-[0.6875rem] text-[0.8125rem] font-medium transition-colors",
    // The active marker is an inset bottom border so it sits on the nav's own
    // baseline rather than adding height and shifting the row.
    "after:absolute after:inset-x-2 after:bottom-0 after:h-[2px] after:rounded-t-full",
    active
      ? "text-ink-950 after:bg-brand-600"
      : "text-ink-600 hover:text-ink-950 after:bg-transparent hover:after:bg-paper-400",
  );
}

function iconClass(active: boolean) {
  return clsx("h-[1rem] w-[1rem]", active ? "text-brand-600" : "text-ink-400");
}

function CountPill({ value }: { value: number }) {
  return (
    <span className="tnum rounded-full bg-maple-500 px-1.5 py-px text-[0.6875rem] font-semibold leading-4 text-white">
      {value > 99 ? "99+" : value}
    </span>
  );
}
