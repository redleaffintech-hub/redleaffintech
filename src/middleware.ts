import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next 16 Proxy (the renamed `middleware`).
 *
 * Two jobs, both of them navigation conveniences rather than authorisation
 * decisions:
 *
 *   1. a signed-in visitor who lands on the marketing home page is sent to their
 *      dashboard instead;
 *   2. a request to `/admin/*` with no admin cookie is sent to `/admin/login`
 *      rather than being allowed to render a page that would redirect anyway.
 *
 * Neither is a control. Both are cookie-*presence* checks — this code cannot
 * read the session, verify the signature, or know whether the holder is still a
 * platform administrator. The real checks stay server-side, in
 * `requireCompany()` for the app and `requirePlatformAdmin()` for the console,
 * and they run on every page, action and API route regardless of what happens
 * here. A stale or forged cookie therefore reaches the guard and is refused;
 * it does not get inside.
 *
 * Security headers are set in next.config.ts so they also cover static assets.
 */

const ADMIN_COOKIE = "rlf_admin";

/** Paths under /admin that must stay reachable without a session. */
const ADMIN_PUBLIC = ["/admin/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/") {
    if (request.cookies.has("rlf_session")) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (ADMIN_PUBLIC.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return NextResponse.next();
    }
    if (!request.cookies.has(ADMIN_COOKIE)) {
      const login = new URL("/admin/login", request.url);
      return NextResponse.redirect(login);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin/:path*"],
};
