"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import {
  addLeaveBalanceAdjustmentAction,
  cancelLeaveRequestAction,
  createLeaveRequestAction,
  decideLeaveRequestAction,
} from "./actions";

interface Option {
  id: string;
  name: string;
}

function EmployeeAndLeaveTypeFields({ employees, leaveTypes }: { employees: Option[]; leaveTypes: Option[] }) {
  return (
    <>
      <Field label="Employee" required>
        <Select name="employeeId" defaultValue="" required>
          <option value="" disabled>Choose…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Leave type" required>
        <Select name="leaveTypeId" defaultValue="" required>
          <option value="" disabled>Choose…</option>
          {leaveTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>
    </>
  );
}

export function NewLeaveRequestButton({ employees, leaveTypes }: { employees: Option[]; leaveTypes: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>New request</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} size="md" title="New leave request">
          <form
            action={async (formData) => {
              if (saving) return;
              setSaving(true);
              setError(null);
              const result = await createLeaveRequestAction(formData);
              setSaving(false);
              if (result?.error) return setError(result.error);
              setOpen(false);
              router.refresh();
            }}
            className="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <EmployeeAndLeaveTypeFields employees={employees} leaveTypes={leaveTypes} />
              <Field label="Start date" required>
                <input type="date" name="startDate" required className={inputClass} />
              </Field>
              <Field label="End date" required>
                <input type="date" name="endDate" required className={inputClass} />
              </Field>
              <Field label="Hours" required hint="Total hours requested across the range.">
                <input name="hours" type="text" inputMode="decimal" required className={inputClass} placeholder="8" />
              </Field>
            </div>
            <Field label="Reason">
              <textarea name="reason" rows={2} className={inputClass} />
            </Field>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Submitting…" : "Submit request"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function AdjustBalanceButton({ employees, leaveTypes }: { employees: Option[]; leaveTypes: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Adjust balance</Button>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          size="md"
          title="Adjust a leave balance"
          description="A signed entry in the employee's leave ledger — an opening balance, an annual accrual grant, a carryover, or a manual correction."
        >
          <form
            action={async (formData) => {
              if (saving) return;
              setSaving(true);
              setError(null);
              const result = await addLeaveBalanceAdjustmentAction(formData);
              setSaving(false);
              if (result?.error) return setError(result.error);
              setOpen(false);
              router.refresh();
            }}
            className="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <EmployeeAndLeaveTypeFields employees={employees} leaveTypes={leaveTypes} />
              <Field label="Hours" required hint="Positive to grant, negative to correct downward.">
                <input name="hours" type="text" inputMode="decimal" required className={inputClass} placeholder="80" />
              </Field>
              <Field label="Effective date" required>
                <input type="date" name="effectiveDate" required className={inputClass} />
              </Field>
            </div>
            <Field label="Reason" required hint="Written to the audit log.">
              <textarea name="reason" rows={2} required className={inputClass} placeholder="2026 annual vacation accrual" />
            </Field>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Add adjustment"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function LeaveRequestRowActions({ request }: { request: { id: string; status: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"decline" | null>(null);
  const [note, setNote] = useState("");

  async function decide(decision: "APPROVED" | "DECLINED", decisionNote?: string) {
    setBusy(true);
    const formData = new FormData();
    formData.set("id", request.id);
    formData.set("decision", decision);
    if (decisionNote) formData.set("decisionNote", decisionNote);
    const result = await decideLeaveRequestAction(formData);
    setBusy(false);
    if (result?.error) alert(result.error);
    else {
      setDialog(null);
      router.refresh();
    }
  }

  async function cancel() {
    setBusy(true);
    const formData = new FormData();
    formData.set("id", request.id);
    const result = await cancelLeaveRequestAction(formData);
    setBusy(false);
    if (result?.error) alert(result.error);
    else router.refresh();
  }

  if (request.status === "PENDING") {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => decide("APPROVED")}
          disabled={busy}
          className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-positive transition-colors hover:bg-positive-soft"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setDialog("decline")}
          disabled={busy}
          className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative transition-colors hover:bg-negative-soft"
        >
          Decline
        </button>

        {dialog === "decline" && (
          <Modal open onClose={() => setDialog(null)} size="md" title="Decline this request">
            <div className="space-y-4">
              <Field label="Note" hint="Optional — shared with the record.">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => setDialog(null)}>Cancel</Button>
                <Button variant="danger" onClick={() => decide("DECLINED", note)} disabled={busy}>
                  {busy ? "Working…" : "Decline request"}
                </Button>
              </div>
            </div>
          </Modal>
        )}
      </span>
    );
  }

  if (request.status === "APPROVED") {
    return (
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
      >
        Cancel
      </button>
    );
  }

  return null;
}
