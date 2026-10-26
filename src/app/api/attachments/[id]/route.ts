import { db } from "@/lib/db";
import { requireCompany } from "@/server/auth/context";

/** Authenticated download of an attachment belonging to the active company. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCompany();
  const { id } = await params;

  const attachment = await db.attachment.findFirst({ where: { id, companyId: company.id } });
  if (!attachment || !attachment.data) return new Response("Not found", { status: 404 });

  const safeName = attachment.fileName.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.data.length),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
