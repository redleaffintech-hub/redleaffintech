import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * Set here rather than in `src/proxy.ts` so they also cover static assets and
 * the image optimiser, and cost nothing per request.
 *
 * HSTS is set by the application rather than left to the host. It used to be
 * omitted because Vercel added it for its own domains; that assumption does not
 * travel, and a security header that silently disappears when the app is
 * rehosted is worse than one declared in the code.
 *
 * No Content-Security-Policy yet: the app inlines a few style attributes and
 * Next injects its own scripts, so a CSP needs a nonce pass before it can be
 * turned on without breaking the product. Tracked for Phase 2.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Two years, subdomains included. No `preload` directive: that is a one-way
  // submission to the browser preload lists and should be a deliberate choice
  // once the production domain is settled, not a side effect of a host move.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Opt in for a portable Node server; hosted adapters retain their own output.
  ...(process.env.STANDALONE_BUILD === "1" ? { output: "standalone" as const } : {}),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
