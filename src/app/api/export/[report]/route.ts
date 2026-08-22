import { NextResponse } from "next/server";
import { requireCompany } from "@/server/auth/context";
import { can } from "@/lib/permissions";
import { contentDisposition } from "@/lib/csv";
import { EXPORTS, ExportError } from "@/server/reports/exports";

/**
 * CSV downloads.
 *
 * The single authorisation point for every export. Three things happen here and
 * nowhere else:
 *
 *  1. The company comes from the session via `requireCompany()`. The client
 *     never sends a company id, so it cannot ask for another tenant's books —
 *     the same rule the rest of the app follows (§3, the membership row IS the
 *     authorisation).
 *  2. The capability declared by the export definition is checked against the
 *     caller's role before any data is read. A reviewer who cannot open the Tax
 *     Centre cannot download the tax detail either.
 *  3. The report is re-run server-side from the same query parameters the page
 *     used, so the file holds the complete filtered result set rather than
 *     whatever rows a paginated screen happened to render.
 *
 * `force-dynamic` because the response depends on the session cookie: a cached
 * export would be one company's books served to another.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const { report } = await params;
  const definition = EXPORTS[report];
  if (!definition) {
    return NextResponse.json({ error: "Unknown export." }, { status: 404 });
  }

  const { company, role } = await requireCompany();
  if (!can(role, definition.capability)) {
    return NextResponse.json({ error: "Your role cannot export this report." }, { status: 403 });
  }

  try {
    const { filename, body } = await definition.build({
      companyId: company.id,
      currency: company.baseCurrency,
      fiscalYearStartMonth: company.fiscalYearStartMonth,
      params: new URL(request.url).searchParams,
    });

    return new NextResponse(body, {
      headers: {
        // charset=utf-8 plus the BOM the serialiser writes: between them Excel
        // reads accented text correctly on every platform.
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDisposition(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ExportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
