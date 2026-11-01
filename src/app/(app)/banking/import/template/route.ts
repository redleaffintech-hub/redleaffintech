import { NextResponse } from "next/server";
import { CAPABILITIES } from "@/lib/permissions";
import { requireCapability } from "@/server/auth/context";
import { contentDisposition } from "@/lib/csv";
import { BANK_STATEMENT_TEMPLATE_CSV } from "@/lib/bank-statement-template";

/** The blank bank-statement CSV, with example rows, for the Import statement panel. */
export async function GET() {
  await requireCapability(CAPABILITIES.BANKING);
  return new NextResponse(BANK_STATEMENT_TEMPLATE_CSV, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition("bank-statement-template.csv"),
      "Cache-Control": "no-store",
    },
  });
}
