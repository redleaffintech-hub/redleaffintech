import { NextResponse } from "next/server";
import { CAPABILITIES, can } from "@/lib/permissions";
import { recordAudit, requireCapability } from "@/server/auth/context";
import { contentDisposition } from "@/lib/csv";
import { today } from "@/lib/dates";
import { isPreset, resolveRange } from "@/lib/export-ranges";
import { buildExportZip, isExportKey, type ExportKey } from "@/server/exports/quickbooks-style";

/**
 * Export data: the QuickBooks-style zip of Excel files. A route handler (not a
 * server action) because the browser has to navigate to it to receive a file.
 * The company comes from the session, never from the URL.
 */
export async function GET(req: Request) {
  const { company, user, role } = await requireCapability(CAPABILITIES.REPORTS);
  const params = new URL(req.url).searchParams;

  const items = [...new Set((params.get("items") ?? "").split(",").filter(Boolean))];
  if (items.length === 0) return NextResponse.json({ error: "Choose at least one report or list to export." }, { status: 400 });
  const bad = items.find((i) => !isExportKey(i));
  if (bad) return NextResponse.json({ error: `Unknown export item: ${bad}` }, { status: 400 });

  // The employee list is personal data: it needs the same access as the HR screens.
  if (items.includes("EMPLOYEES") && !(can(role, CAPABILITIES.HR) && company.enabledModules.includes("HR"))) {
    return NextResponse.json({ error: "You do not have access to export the employee list." }, { status: 403 });
  }

  const preset = params.get("range") ?? "ALL";
  if (!isPreset(preset)) return NextResponse.json({ error: "Unknown date range." }, { status: 400 });
  let range;
  try {
    range = resolveRange(preset, {
      today: today(),
      fiscalYearStartMonth: company.fiscalYearStartMonth,
      customFrom: params.get("from"),
      customTo: params.get("to"),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const result = await buildExportZip({
    companyId: company.id,
    companyName: company.name,
    range,
    items: items as ExportKey[],
  });

  await recordAudit({
    companyId: company.id,
    userId: user.id,
    action: "EXPORT",
    entityType: "Company",
    entityId: company.id,
    summary: `Exported data (${range.label}): ${result.files.join(", ")}`,
  });

  return new Response(Buffer.from(result.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(result.filename),
      "Cache-Control": "no-store",
    },
  });
}
