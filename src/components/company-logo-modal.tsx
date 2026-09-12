"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui";
import { updateCompanyLogoAction } from "@/app/(app)/company/actions";
import { fileToLogoDataUrl, MAX_LOGO_DATA_URL_LENGTH } from "@/lib/logo";

/**
 * Upload / replace / remove the company logo. Shared by the topbar's quick-
 * change menu and the Company profile page, so there is exactly one place
 * that resizes, validates and saves it.
 *
 * Mounted only while open (each caller renders it conditionally rather than
 * passing an `open` flag), so each open starts from a fresh `preview` state
 * seeded from the current logo — no effect needed to resync it.
 */
export function CompanyLogoModal({
  onClose,
  currentLogoUrl,
}: {
  onClose: () => void;
  currentLogoUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(currentLogoUrl);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      if (dataUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
        return setError("That image is too large even after resizing. Try a simpler logo.");
      }
      setPreview(dataUrl);
    } catch {
      setError("Could not read that image.");
    }
  }

  async function save(next: string | null) {
    setSaving(true);
    setError(null);
    const result = await updateCompanyLogoAction(next);
    setSaving(false);
    if (result?.error) return setError(result.error);
    router.refresh();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Company logo" description="Resized to fit within 256×256, shown wherever the company appears.">
      <div className="flex items-center gap-3">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a resized data URL, not an optimizable remote asset
          <img src={preview} alt="Company logo" className="h-16 w-16 rounded-md border border-paper-300 bg-white object-contain p-1" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-paper-400 text-[0.6875rem] text-muted-ink">
            No logo
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="inline-flex cursor-pointer items-center rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100">
            {preview ? "Replace logo" : "Upload logo"}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
          </label>
          {preview && (
            <button type="button" onClick={() => setPreview(null)} className="text-left text-[0.75rem] text-muted-ink hover:underline">
              Remove logo
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button variant="primary" disabled={saving || preview === currentLogoUrl} onClick={() => save(preview)}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
