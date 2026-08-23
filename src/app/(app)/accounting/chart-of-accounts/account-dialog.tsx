"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, subtypeLabel, type AccountType } from "@/lib/enums";
import { createAccountAction, deleteAccountAction, setAccountActiveAction, updateAccountAction } from "./actions";

const TYPE_LABEL: Record<AccountType, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expense",
};

export interface EditableAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  description: string;
  isActive: boolean;
  isSystem: boolean;
}

const BLANK: EditableAccount = {
  id: "",
  code: "",
  name: "",
  type: "EXPENSE",
  subtype: "OPERATING_EXPENSE",
  description: "",
  isActive: true,
  isSystem: false,
};

export function NewAccountButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Add account</Button>
      {open && <AccountDialog account={BLANK} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AccountRowActions({
  account,
  referenced,
}: {
  account: EditableAccount;
  referenced: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ error?: string } | void>) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    const failed = result && "error" in result ? result.error : null;
    if (failed) setError(failed);
    else router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
        >
          Edit
        </button>
        {!account.isSystem && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => setAccountActiveAction(account.id, !account.isActive))}
            className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200 disabled:opacity-50"
          >
            {account.isActive ? "Deactivate" : "Reactivate"}
          </button>
        )}
        {!account.isSystem && !referenced && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Delete ${account.code} — ${account.name}? It is not referenced anywhere, so this is permanent.`)) return;
              void run(() => deleteAccountAction(account.id));
            }}
            className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative transition-colors hover:bg-negative-soft disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </span>
      {error && <span className="max-w-[16rem] text-right text-[0.6875rem] text-negative">{error}</span>}
      {editing && <AccountDialog account={account} onClose={() => setEditing(false)} />}
    </span>
  );
}

function AccountDialog({ account, onClose }: { account: EditableAccount; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<AccountType>(account.type);
  const isNew = account.id === "";
  const subtypeOptions = ACCOUNT_SUBTYPES[type] ?? [];

  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? "Add account" : `Edit ${account.code}`}>
      <form
        action={async (formData) => {
          if (saving) return;
          setSaving(true);
          setError(null);
          const result = isNew
            ? await createAccountAction(formData)
            : await updateAccountAction(account.id, formData);
          setSaving(false);
          const failed = result && "error" in result ? result.error : null;
          if (failed) {
            setError(failed);
            return;
          }
          onClose();
          router.refresh();
        }}
        className="space-y-4"
      >
        {account.isSystem && (
          <p className="rounded-md border border-[color:var(--color-caution)]/30 bg-caution-soft px-3 py-2 text-[0.75rem] leading-5 text-caution">
            This is a system account the posting engine looks up directly. Its code, type and classification cannot
            change, and it cannot be deactivated. Name and description are still editable.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Code" required>
            <input
              name="code"
              defaultValue={account.code}
              required
              maxLength={20}
              disabled={account.isSystem}
              className={clsx(inputClass, "tnum", account.isSystem && "cursor-not-allowed bg-paper-100 text-muted-ink")}
            />
            {account.isSystem && <input type="hidden" name="code" value={account.code} />}
          </Field>
          <Field label="Type" required className="sm:col-span-2">
            <select
              name="type"
              value={type}
              disabled={account.isSystem}
              onChange={(event) => setType(event.target.value as AccountType)}
              className={clsx(inputClass, "pr-8", account.isSystem && "cursor-not-allowed bg-paper-100 text-muted-ink")}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
            {account.isSystem && <input type="hidden" name="type" value={account.type} />}
          </Field>
        </div>

        <Field label="Classification" required hint="Decides where the account sits on the P&L and balance sheet.">
          <select
            name="subtype"
            defaultValue={account.subtype}
            disabled={account.isSystem}
            className={clsx(inputClass, "pr-8", account.isSystem && "cursor-not-allowed bg-paper-100 text-muted-ink")}
          >
            {subtypeOptions.map((s) => (
              <option key={s} value={s}>{subtypeLabel(s)}</option>
            ))}
          </select>
          {account.isSystem && <input type="hidden" name="subtype" value={account.subtype} />}
        </Field>

        <Field label="Name" required>
          <input name="name" defaultValue={account.name} required maxLength={120} className={inputClass} />
        </Field>

        <Field label="Description">
          <textarea name="description" defaultValue={account.description} rows={2} maxLength={500} className={inputClass} />
        </Field>

        <label
          className={clsx(
            "flex items-start gap-2 rounded-lg border border-paper-300 p-3",
            account.isSystem ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          )}
        >
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={account.isActive}
            disabled={account.isSystem}
            className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
          />
          {account.isSystem && <input type="hidden" name="isActive" value="on" />}
          <span className="text-[0.8125rem] leading-5 text-ink-800">
            Active
            <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
              An inactive account is hidden from new documents. Historical reports still show it exactly as posted.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : isNew ? "Add account" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
