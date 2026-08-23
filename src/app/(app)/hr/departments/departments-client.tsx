"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { createDepartmentAction, deleteDepartmentAction, renameDepartmentAction } from "./actions";

export function AddDepartmentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Add department</Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} size="md" title="Add a department">
          <form
            action={async (formData) => {
              if (saving) return;
              setSaving(true);
              setError(null);
              const result = await createDepartmentAction(formData);
              setSaving(false);
              if (result?.error) {
                setError(result.error);
                return;
              }
              setOpen(false);
              router.refresh();
            }}
            className="space-y-4"
          >
            <Field label="Department name" required>
              <input name="name" autoFocus required maxLength={80} className={inputClass} placeholder="Operations" />
            </Field>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Adding…" : "Add department"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function DepartmentRowActions({ department }: { department: { id: string; name: string; employeeCount: number } }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setDialog("rename")}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
      >
        Rename
      </button>
      <button
        type="button"
        onClick={() => setDialog("delete")}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative transition-colors hover:bg-negative-soft"
      >
        Delete
      </button>

      {dialog === "rename" && (
        <Modal open onClose={() => setDialog(null)} size="md" title={`Rename "${department.name}"`}>
          <form
            action={async (formData) => {
              if (saving) return;
              setSaving(true);
              setError(null);
              const result = await renameDepartmentAction(formData);
              setSaving(false);
              if (result?.error) {
                setError(result.error);
                return;
              }
              setDialog(null);
              router.refresh();
            }}
            className="space-y-4"
          >
            <input type="hidden" name="id" value={department.id} />
            <Field label="Department name" required>
              <input name="name" autoFocus required maxLength={80} defaultValue={department.name} className={inputClass} />
            </Field>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </form>
        </Modal>
      )}

      {dialog === "delete" && (
        <Modal open onClose={() => setDialog(null)} size="md" title={`Delete "${department.name}"`}>
          <form
            action={async (formData) => {
              if (saving) return;
              setSaving(true);
              setError(null);
              const result = await deleteDepartmentAction(formData);
              setSaving(false);
              if (result?.error) {
                setError(result.error);
                return;
              }
              setDialog(null);
              router.refresh();
            }}
            className="space-y-4"
          >
            <input type="hidden" name="id" value={department.id} />
            <p className="text-[0.8125rem] leading-5 text-muted-ink">
              {department.employeeCount > 0
                ? `This department has ${department.employeeCount} employee(s) assigned. Move them to another department first.`
                : "This department has no employees assigned and can be deleted."}
            </p>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="danger" disabled={saving || department.employeeCount > 0}>
                {saving ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </span>
  );
}
