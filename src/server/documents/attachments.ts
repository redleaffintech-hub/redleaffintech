/**
 * File attachments on documents (currently expenses).
 *
 * The bytes live in the Attachment row itself — there is no object storage or
 * persistent disk on the host — and are only ever served through the
 * authenticated /api/attachments/[id] route, never as a public URL.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_REQUEST_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

export interface UploadedFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Real uploads from a form: empty file inputs arrive as zero-byte entries and are skipped. */
export function filesFromForm(formData: FormData, field = "files"): UploadedFile[] {
  return formData.getAll(field).filter((entry): entry is File => typeof entry !== "string" && entry.size > 0);
}

export function validateFiles(files: UploadedFile[]): string | null {
  let total = 0;
  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}: only PDF, JPG and PNG files can be attached.`;
    if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`;
    total += file.size;
  }
  if (total > MAX_ATTACHMENTS_PER_REQUEST_BYTES) return "Attach at most 5 MB at a time.";
  return null;
}

export async function saveAttachments(input: {
  companyId: string;
  sourceType: string;
  sourceId: string;
  files: UploadedFile[];
  userId?: string | null;
}) {
  for (const file of input.files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    await db.attachment.create({
      data: {
        companyId: input.companyId,
        fileName: file.name.slice(0, 200),
        mimeType: file.type,
        sizeBytes: bytes.length,
        storageKey: `db:${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}`,
        data: bytes,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        uploadedById: input.userId ?? null,
      },
    });
  }
}

export function listAttachments(companyId: string, sourceType: string, sourceId: string) {
  return db.attachment.findMany({
    where: { companyId, sourceType, sourceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
  });
}
