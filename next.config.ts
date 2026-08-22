import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * Set here rather than in `src/proxy.ts` so they also cover static assets and
 * the image optimiser, and cost nothing per request. Vercel already terminates
 * TLS and adds HSTS for its own domains, so that one is left to the platform.
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
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
