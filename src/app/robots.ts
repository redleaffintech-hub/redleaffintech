import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://redleaffintech.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The application itself is authenticated; keep it out of the index.
        disallow: ["/dashboard", "/sales", "/purchases", "/expenses", "/banking", "/accounting", "/tax", "/reports", "/company", "/firm", "/api", "/login", "/signup"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
