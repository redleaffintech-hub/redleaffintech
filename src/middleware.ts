import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next 16 Proxy (the renamed `middleware`).
 *
 * One job only: a signed-in visitor who lands on the marketing home page is
 * sent to their dashboard instead. This is a cheap cookie-presence check, not
 * an authorisation decision — the real check stays server-side in
 * `requireCompany()` (src/server/auth/context.ts), which is what gates every
 * page under (app). A stale cookie therefore ends up at /login, not inside the
 * app.
 *
 * Nothing else is gated here. The (marketing) route group is public by
 * construction because it never calls requireUser/requireCompany, and security
 * headers are set in next.config.ts so they also cover static assets.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.has("rlf_session")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
