"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { LEAVE_CATEGORIES, LEAVE_CATEGORY_LABELS } from "@/lib/hr-enums";
import { createLeaveTypeAction, setLeaveTypeActiveAction, updateLeaveTypeAction } from "./actions";

interface LeaveTypeRow {
  id: string;
  name: string;
  category: string;
  isPaid: boolean;
  trackBalance: boolean;
  isActive: boolean;
}

function CategoryFields({ defaults }: { defaults?: Pick<LeaveTypeRow, "category" | "isPaid"> }) {
  return (
    <>
      <Field label="Category" required>
        <Select name="category" defaultValue={defaults?.category ?? "OTHER"} required>
          {LEAVE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{LEAVE_CATEGORY_LABELS[c]}</option>
          ))}
        </Select>
      </Field>
      <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-800">
        <input type="checkbox" name="isPaid" defaultChecked={defaults?.isPaid ?? true} className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]" />
        Paid leave
      </label>
    </>
  );
}

export function AddLeaveTypeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Add leave type</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} size="md" title="Add a leave type">
          <form
            action={async (formData) => {
              if (saving) return;
              setSaving(true);
              setError(null);
              const result = await createLeaveTypeAction(formData);
              setSaving(false);
              if (result?.error) return setError(result.error);
              setOpen(false);
              router.refresh();
            }}
            className="space-y-4"
          >
            <Field label="Name" required>
              <input name="name" autoFocus required maxLength={80} className={inputClass} placeholder="Wellness day" />
            </Field>
            <CategoryFields />
            <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-800">
              <input type="checkbox" name="trackBalance" defaultChecked className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]" />
              Track a running balance (unchecked: a job-protected leave that is simply recorded, not accrued/drawn down)
            </label>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Adding…" : "Add leave type"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function LeaveTypeRowActions({ leaveType }: { leaveType: LeaveTypeRow }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function toggleActive() {
    setSaving(true);
    const formData = new FormData();
    formData.set("id", leaveType.id);
    formData.set("isActive", leaveType.isActive ? "false" : "true");
    const result = await setLeaveTypeActiveAction(formData);
    setSaving(false);
    if (result?.error) alert(result.error);
    else router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setDialog("edit")}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={toggleActive}
        disabled={saving}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
      >
        {leaveType.isActive ? "Deactivate" : "Activate"}
      </button>

      {dialog === "edit" && (
        <Modal open onClose={() => setDialog(null)} size="md" title={`Edit "${leaveType.name}"`}>
          <form
            action={async (formData) => {
              if (saving) return;
              setSaving(true);
              setError(null);
              const result = await updateLeaveTypeAction(formData);
              setSaving(false);
              if (result?.error) return setError(result.error);
              setDialog(null);
              router.refresh();
            }}
            className="space-y-4"
          >
            <input type="hidden" name="id" value={leaveType.id} />
            <Field label="Name" required>
              <input name="name" autoFocus required maxLength={80} defaultValue={leaveType.name} className={inputClass} />
            </Field>
            <CategoryFields defaults={leaveType} />
            <p className="text-[0.75rem] text-muted-ink">
              Balance tracking ({leaveType.trackBalance ? "on" : "off"}) is set at creation and cannot be changed — it would make existing balance history ambiguous.
            </p>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </span>
  );
}
