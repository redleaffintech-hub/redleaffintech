/**
 * Constants shared between the admin portal's server code and its client
 * components.
 *
 * `src/server/admin/csrf.ts` cannot be imported from a client component — it is
 * `server-only` and pulls in the session secret — so the one thing a form needs
 * from it, the field name, lives here instead.
 */

/** The hidden form field carrying the per-session CSRF token. */
export const CSRF_FIELD = "_csrf";

/** Where an unauthenticated admin request is sent. */
export const ADMIN_LOGIN_PATH = "/admin/login";

export interface AdminNavItem {
  label: string;
  href: string;
  /** Match the path exactly rather than by prefix — for the dashboard root. */
  exact?: boolean;
  description: string;
}

/**
 * The portal's navigation.
 *
 * Hiding a link here is a convenience for the operator, never a control: every
 * page behind these hrefs calls `requirePlatformAdmin()` for itself.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", exact: true, description: "Platform health at a glance" },
  { label: "Clients", href: "/admin/clients", description: "Client companies and their files" },
  { label: "Users", href: "/admin/users", description: "People, and the companies they belong to" },
  { label: "Subscriptions", href: "/admin/subscriptions", description: "Plans, trials, seats and billing state" },
  { label: "Plans & pricing", href: "/admin/plans", description: "The catalogue the public site sells" },
  {
    label: "Regional tax rates",
    href: "/admin/regional-tax-rates",
    description: "The central GST/HST/PST/QST/RST reference every company's tax setup draws from",
  },
  { label: "Platform admins", href: "/admin/administrators", description: "Who can reach this console" },
  { label: "Admin audit log", href: "/admin/audit", description: "Every platform action, recorded" },
  { label: "Settings", href: "/admin/settings", description: "Your own account and security" },
];

/**
 * Route prop shapes for the admin portal.
 *
 * Next's generated `PageProps<"/route">` helper is written by the build, so a
 * freshly added route does not type-check until a build has run. The portal
 * declares its own params instead — same shape, no dependency on codegen having
 * caught up.
 */
export type AdminSearchParams = Promise<Record<string, string | string[] | undefined>>;
export type AdminParams<K extends string> = Promise<Record<K, string>>;
