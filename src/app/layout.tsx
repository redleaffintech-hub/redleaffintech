import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";

/**
 * The wordmark is a wide geometric sans; Montserrat is the closest free face,
 * and it is used only for marketing display type (`font-display`). The
 * application itself stays on the system stack — its tables are tuned to it.
 */
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://redleaffintech.com"),
  title: {
    default: "Red Leaf Fintech — business management for Canadian companies",
    template: "%s · Red Leaf Fintech",
  },
  description:
    "Red Leaf Fintech is a complete business management platform for Canadian companies — accounting today, with payroll, HR, tax, payments, banking and inventory to follow. Double-entry ledger, GST/HST/PST tax engine, banking, reconciliation and traceable financial reports.",
  // The app is reachable on its own domain *and* on the project's
  // `.vercel.app` host, which serves identical pages. A relative canonical
  // resolves against `metadataBase` per route, so every page names its address
  // on the real domain and the two hosts are never indexed as duplicates.
  alternates: { canonical: "./" },
  openGraph: {
    title: "Red Leaf Fintech",
    description:
      "One platform for accounting, payroll, HR, tax, payments, banking and inventory. Built in Canada, for Canadian businesses and the accountants who serve them.",
    siteName: "Red Leaf Fintech",
    locale: "en_CA",
    type: "website",
    url: "./",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-CA" className={`${montserrat.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
