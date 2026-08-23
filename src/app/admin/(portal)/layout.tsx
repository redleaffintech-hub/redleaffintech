import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminShell } from "@/components/admin/shell";
import { adminSignOutAction } from "../login/actions";

/**
 * The guarded half of `/admin`.
 *
 * `requirePlatformAdmin()` here covers every page in the group, but it is not
 * the only place it is called: each page and every server action calls it again
 * for itself. That repetition is deliberate. A layout guard protects what the
 * layout renders; it does not protect a server action, which is its own POST
 * endpoint and would otherwise be reachable by anyone who knows its id.
 */
export default async function AdminPortalLayout({ children }: { children: ReactNode }) {
  const actor = await requirePlatformAdmin();

  return (
    <AdminShell
      user={{ name: actor.name, email: actor.email, mfaEnabled: actor.mfaEnabled }}
      csrfToken={actor.csrfToken}
      signOutAction={adminSignOutAction}
    >
      {children}
    </AdminShell>
  );
}
