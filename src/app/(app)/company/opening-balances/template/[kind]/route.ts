import { NextResponse } from "next/server";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability } from "@/server/auth/context";
import { contentDisposition } from "@/lib/csv";

/**
 * The downloadable CSV template for bulk A/R (customers) or A/P (vendors)
 * opening balances. Static headings plus one example row; the import in
 * actions.ts reads these headings back.
 */
const HEADINGS = (party: string) =>
  [`${party} Name`, "Email", "Phone", "Address Line 1", "Address Line 2", "City", "Province", "Postal Code", "Opening Balance", "As of Date"];

const EXAMPLE = {
  CUSTOMER: ["Example Customer Inc.", "accounts@example.ca", "905-555-0100", "123 Main St", "Unit 4", "Brampton", "ON", "L6Y 1A1", "1250.00", "2026-03-31"],
  VENDOR: ["Example Supplier Ltd.", "billing@example.ca", "905-555-0199", "45 Industrial Rd", "", "Brampton", "ON", "L6T 2B2", "830.50", "2026-03-31"],
} as const;

export async function GET(_req: Request, ctx: { params: Promise<{ kind: string }> }) {
  await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  const { kind } = await ctx.params;
  const key = kind === "ar" ? "CUSTOMER" : kind === "ap" ? "VENDOR" : null;
  if (!key) return new NextResponse("Not found", { status: 404 });

  const party = key === "CUSTOMER" ? "Customer" : "Vendor";
  const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const body = "﻿" + [HEADINGS(party), [...EXAMPLE[key]]].map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(`${key === "CUSTOMER" ? "AR" : "AP"}-opening-balance-template.csv`),
      "Cache-Control": "no-store",
    },
  });
}
