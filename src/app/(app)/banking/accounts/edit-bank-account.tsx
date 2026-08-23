"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { updateBankAccountAction } from "./actions";

const TYPE_LABEL: Record<string, string> = { BANK: "Bank", CREDIT_CARD: "Credit card", CASH: "Cash" };

export interface EditableBankAccount {
  id: string;
  name: string;
  institution: string;
  accountNumberMasked: string;
  type: string;
  currency: string;
  accountId: string;
  isActive: boolean;
  /** True once any transaction or reconciliation exists — locks type/currency/GL account. */
  locked: boolean;
}

export interface GlAccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

export function EditBankAccountButton({
  account,
  glAccounts,
}: {
  account: EditableBankAccount;
  glAccounts: GlAccountOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
      >
        Edit
      </button>
      {open && <EditBankAccountDialog account={account} glAccounts={glAccounts} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditBankAccountDialog({
  account,
  glAccounts,
  onClose,
}: {
  account: EditableBankAccount;
  glAccounts: GlAccountOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Compatible GL accounts for the type currently selected in the form, so a
  // credit card is never pointed at a revenue account by accident. The
  // currently-linked account is always offered even if it would not otherwise
  // qualify, so an unusual pre-existing setup never disappears from the list.
  const [type, setType] = useState(account.type);
  const eligible = glAccounts.filter(
    (a) => a.id === account.accountId || (type === "CREDIT_CARD" ? a.type === "LIABILITY" : a.type === "ASSET"),
  );

  return (
    <Modal open onClose={onClose} size="lg" title={`Edit ${account.name}`}>
      <form
        action={async (formData) => {
          if (saving) return;
          setSaving(true);
          setError(null);
          const result = await updateBankAccountAction(formData);
          setSaving(false);
          if (result?.error) {
            setError(result.error);
            return;
          }
          onClose();
          router.refresh();
        }}
        className="space-y-4"
      >
        <input type="hidden" name="bankAccountId" value={account.id} />

        {account.locked && (
          <p className="rounded-md border border-[color:var(--color-caution)]/30 bg-caution-soft px-3 py-2 text-[0.75rem] leading-5 text-caution">
            This account has transactions or a reconciliation on record, so its type, currency and linked GL account
            are locked. Name, institution, masked number and active status can still be changed.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <input name="name" defaultValue={account.name} required maxLength={120} className={inputClass} />
          </Field>
          <Field label="Institution">
            <input name="institution" defaultValue={account.institution} maxLength={120} className={inputClass} />
          </Field>
        </div>

        <Field label="Masked account number" hint="Display only, e.g. •••• 4471.">
          <input name="accountNumberMasked" defaultValue={account.accountNumberMasked} maxLength={30} className={clsx(inputClass, "tnum")} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select
              name="type"
              value={type}
              disabled={account.locked}
              onChange={(event) => setType(event.target.value)}
              className={clsx(inputClass, "pr-8", account.locked && "cursor-not-allowed bg-paper-100 text-muted-ink")}
            >
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {account.locked && <input type="hidden" name="type" value={account.type} />}
          </Field>
          <Field label="Currency">
            <input
              name={account.locked ? undefined : "currency"}
              defaultValue={account.currency}
              disabled={account.locked}
              maxLength={3}
              className={clsx(inputClass, "uppercase tnum", account.locked && "cursor-not-allowed bg-paper-100 text-muted-ink")}
            />
            {/* A disabled input submits nothing at all — unlike type and
                accountId above, there is no separate display element here, so
                the hidden fallback carries the value instead of the display
                field switching name. */}
            {account.locked && <input type="hidden" name="currency" value={account.currency} />}
          </Field>
        </div>

        <Field label="Linked GL account" hint={account.locked ? undefined : "Determines which balance sheet account this feed posts to."}>
          <select
            name="accountId"
            defaultValue={account.accountId}
            disabled={account.locked}
            className={clsx(inputClass, "pr-8", account.locked && "cursor-not-allowed bg-paper-100 text-muted-ink")}
          >
            {eligible.map((a) => (
              <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
            ))}
          </select>
          {account.locked && <input type="hidden" name="accountId" value={account.accountId} />}
        </Field>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-paper-300 p-3">
          <input type="checkbox" name="isActive" defaultChecked={account.isActive} className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-brand-600)]" />
          <span className="text-[0.8125rem] leading-5 text-ink-800">
            Active
            <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
              An inactive account is hidden from new imports and reconciliation, and its history stays intact.
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
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
