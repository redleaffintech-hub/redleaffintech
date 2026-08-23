import type { Metadata } from "next";

/**
 * The outermost admin layout. Deliberately does no authorisation: `/admin/login`
 * lives inside this segment and has to be reachable by someone with no session
 * at all. The guard sits one level down, on the `(portal)` group, so every page
 * that is not the sign-in flow inherits it.
 */

export const metadata: Metadata = {
  title: {
    default: "Platform administration",
    template: "%s · Red Leaf platform",
  },
  // A private console has no business in an index, and the sign-in page is the
  // one part of it a crawler could otherwise reach.
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
