"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { TERMINATION_REASON_CATEGORIES, TERMINATION_REASON_LABELS } from "@/lib/hr-enums";
import { reactivateEmployeeAction, setOnLeaveAction, terminateEmployeeAction } from "../actions";

interface EmployeeSummary {
  id: string;
  name: string;
  employmentStatus: string;
  hireDate: string;
}

export function EmployeeActions({ employee }: { employee: EmployeeSummary }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"terminate" | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(
    action: (formData: FormData) => Promise<{ error?: string } | void>,
    extra?: Record<string, string>,
  ) {
    setBusy(true);
    const formData = new FormData();
    formData.set("id", employee.id);
    for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value);
    const result = await action(formData);
    setBusy(false);
    if (result && "error" in result && result.error) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  if (employee.employmentStatus === "TERMINATED") {
    return (
      <Button onClick={() => run(reactivateEmployeeAction)} disabled={busy}>
        {busy ? "Working…" : "Reactivate"}
      </Button>
    );
  }

  return (
    <>
      {employee.employmentStatus === "ON_LEAVE" ? (
        <Button onClick={() => run(setOnLeaveAction, { onLeave: "false" })} disabled={busy}>
          Mark active
        </Button>
      ) : (
        <Button onClick={() => run(setOnLeaveAction, { onLeave: "true" })} disabled={busy}>
          Mark on leave
        </Button>
      )}
      <Button onClick={() => setDialog("terminate")} disabled={busy}>
        Terminate
      </Button>

      {dialog === "terminate" && (
        <TerminateDialog employee={employee} onClose={() => setDialog(null)} onSuccess={() => router.refresh()} />
      )}
    </>
  );
}

function TerminateDialog({
  employee,
  onClose,
  onSuccess,
}: {
  employee: EmployeeSummary;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <Modal open onClose={onClose} size="md" title={`Terminate ${employee.name}`}>
      <form
        action={async (formData) => {
          if (saving) return;
          setSaving(true);
          setError(null);
          const result = await terminateEmployeeAction(formData);
          setSaving(false);
          if (result?.error) {
            setError(result.error);
            return;
          }
          onClose();
          onSuccess();
        }}
        className="space-y-4"
      >
        <input type="hidden" name="id" value={employee.id} />
        <p className="text-[0.8125rem] leading-5 text-muted-ink">
          Moves {employee.name} to Terminated. Any employee reporting to them loses that reporting line rather than
          staying pointed at a terminated manager — reassign their reports afterward if needed.
        </p>

        <Field label="Termination date" required>
          <input type="date" name="terminationDate" min={employee.hireDate} required className={inputClass} />
        </Field>

        <Field label="Reason" required>
          <Select name="terminationReason" defaultValue="" required>
            <option value="" disabled>Choose…</option>
            {TERMINATION_REASON_CATEGORIES.map((r) => (
              <option key={r} value={r}>{TERMINATION_REASON_LABELS[r]}</option>
            ))}
          </Select>
        </Field>

        <Field label="Note" hint="Written to the audit log.">
          <textarea name="terminationNote" rows={2} className={inputClass} />
        </Field>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={saving}>
            {saving ? "Working…" : "Terminate employee"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
