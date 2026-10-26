"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, inputClass } from "@/components/ui";
import { addExpenseAttachmentsAction, removeExpenseAttachmentAction } from "../actions";

export interface AttachmentRow {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function ExpenseAttachments({ expenseId, attachments }: { expenseId: string; attachments: AttachmentRow[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      {attachments.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-ink">No receipt attached yet.</p>
      ) : (
        <ul className="divide-y divide-paper-200">
          {attachments.map((file) => (
            <li key={file.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
              <a href={`/api/attachments/${file.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-brand-700 hover:underline">
                {file.fileName}
              </a>
              <span className="text-[0.75rem] text-muted-ink">{kb(file.sizeBytes)}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Remove ${file.fileName}?`)) return;
                  startTransition(async () => {
                    const result = await removeExpenseAttachmentAction(file.id);
                    if ("error" in result && result.error) setError(result.error);
                    else router.refresh();
                  });
                }}
                className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative hover:bg-negative-soft disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={formRef}
        className="mt-3 flex flex-wrap items-center gap-2"
        action={(formData) => {
          setError(null);
          startTransition(async () => {
            const result = await addExpenseAttachmentsAction(expenseId, formData);
            if ("error" in result && result.error) setError(result.error);
            else {
              formRef.current?.reset();
              router.refresh();
            }
          });
        }}
      >
        <input name="files" type="file" multiple accept="application/pdf,image/png,image/jpeg" className={inputClass + " max-w-xs"} />
        <Button type="submit" disabled={pending}>{pending ? "Uploading…" : "Attach"}</Button>
      </form>
      {error && <p className="mt-2 text-[0.8125rem] text-negative">{error}</p>}
    </div>
  );
}
