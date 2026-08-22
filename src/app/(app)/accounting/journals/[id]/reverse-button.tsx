"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { Dialog } from "@/app/(app)/sales/invoices/[id]/invoice-actions";
import { reverseJournalAction } from "../actions";

export function ReverseButton({ entryId, entryNo }: { entryId: string; entryNo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Reverse entry
      </Button>

      {open && (
        <Dialog title={`Reverse ${entryNo}`} onClose={() => setOpen(false)}>
          <form
            action={async (formData) => {
              setSaving(true);
              setError(null);
              const result = await reverseJournalAction(entryId, String(formData.get("reason") ?? ""));
              setSaving(false);
              if (result?.error) setError(result.error);
              else if (result?.redirectTo) {
                setOpen(false);
                router.push(result.redirectTo);
              }
            }}
            className="space-y-3"
          >
            <p className="text-[0.8125rem] leading-6 text-ink-700">
              This creates a new mirror-image entry that cancels {entryNo}. The original stays in the ledger — nothing is
              edited or deleted, so the audit trail shows both the error and the correction.
            </p>
            <Field label="Reason" hint="Recorded on the reversal and in the audit log.">
              <input name="reason" className={inputClass} placeholder="Posted to the wrong account" />
            </Field>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={saving}>
                {saving ? "Reversing…" : "Post reversal"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
