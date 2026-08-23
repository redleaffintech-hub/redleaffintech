"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Modal } from "@/components/modal";
import { deletePayRunAction, postPayRunAction, voidPayRunAction } from "../actions";

export function PayRunActions({ payRun }: { payRun: { id: string; number: string; status: string } }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"post" | "void" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function run(action: (formData: FormData) => Promise<{ error?: string; ok?: boolean }>, onDone?: () => void) {
    setSaving(true);
    setError(null);
    const formData = new FormData();
    formData.set("id", payRun.id);
    const result = await action(formData);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setDialog(null);
    if (onDone) onDone();
    else router.refresh();
  }

  if (payRun.status === "DRAFT") {
    return (
      <>
        <Button variant="primary" onClick={() => setDialog("post")}>Post</Button>
        <Button variant="danger" onClick={() => setDialog("delete")}>Delete</Button>

        {dialog === "post" && (
          <Modal open onClose={() => setDialog(null)} size="md" title={`Post pay run ${payRun.number}`}>
            <div className="space-y-4">
              <p className="text-[0.8125rem] leading-6 text-ink-700">
                Posts a journal entry for this pay run&rsquo;s gross wages, withholdings and net pay, and funds net pay from
                the account chosen on the draft. Posted pay runs cannot be edited — void and recreate to correct one.
              </p>
              {error && <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
                <Button variant="primary" onClick={() => run(postPayRunAction)} disabled={saving}>
                  {saving ? "Posting…" : "Post pay run"}
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {dialog === "delete" && (
          <Modal open onClose={() => setDialog(null)} size="md" title={`Delete pay run ${payRun.number}`}>
            <div className="space-y-4">
              <p className="text-[0.8125rem] leading-6 text-ink-700">
                This draft has never been posted, so deleting it removes it completely. This cannot be undone.
              </p>
              {error && <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
                <Button variant="danger" onClick={() => run(deletePayRunAction, () => router.push("/payroll/pay-runs"))} disabled={saving}>
                  {saving ? "Deleting…" : "Delete draft"}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </>
    );
  }

  if (payRun.status === "POSTED") {
    return (
      <>
        <Button variant="danger" onClick={() => setDialog("void")}>Void</Button>
        {dialog === "void" && (
          <Modal open onClose={() => setDialog(null)} size="md" title={`Void pay run ${payRun.number}`}>
            <div className="space-y-4">
              <p className="text-[0.8125rem] leading-6 text-ink-700">
                Reverses the journal entry this pay run posted — a new, opposite entry is created, the original stays
                in the ledger for the audit trail. This does not undo any actual bank payment; it only corrects the books.
              </p>
              {error && <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button>
                <Button variant="danger" onClick={() => run(voidPayRunAction)} disabled={saving}>
                  {saving ? "Voiding…" : "Void pay run"}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </>
    );
  }

  return null;
}
