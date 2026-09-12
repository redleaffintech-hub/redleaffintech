"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { createBankAccountAction } from "./actions";
import type { GlAccountOption } from "./edit-bank-account";

const TYPE_LABEL: Record<string, string> = { BANK: "Bank", CREDIT_CARD: "Credit card", CASH: "Cash" };

export function AddBankAccountButton({
  glAccounts,
  currency,
}: {
  glAccounts: GlAccountOption[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Add bank account
      </Button>
      {open && <AddBankAccountDialog glAccounts={glAccounts} currency={currency} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddBankAccountDialog({
  glAccounts,
  currency,
  onClose,
}: {
  glAccounts: GlAccountOption[];
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<string>("BANK");

  // Same-type filter as the edit dialog: a credit card links to a liability
  // account, everything else to an asset account.
  const eligible = glAccounts.filter((a) => (type === "CREDIT_CARD" ? a.type === "LIABILITY" : a.type === "ASSET"));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Add a bank or card account"
      description="Links a Chart of Accounts entry into reconciliation, CSV import and rules. Each GL account can back only one of these."
    >
      <form
        action={async (formData) => {
          if (saving) return;
          setSaving(true);
          setError(null);
          const result = await createBankAccountAction(formData);
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>
            <input name="name" required maxLength={120} placeholder="Business Chequing" className={inputClass} />
          </Field>
          <Field label="Institution">
            <input name="institution" maxLength={120} placeholder="e.g. RBC" className={inputClass} />
          </Field>
        </div>

        <Field label="Masked account number" hint="Display only, e.g. •••• 4471.">
          <input name="accountNumberMasked" maxLength={30} className={clsx(inputClass, "tnum")} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className={clsx(inputClass, "pr-8")}
            >
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Currency">
            <input name="currency" defaultValue={currency} maxLength={3} className={clsx(inputClass, "uppercase tnum")} />
          </Field>
        </div>

        <Field
          label="Linked GL account"
          hint={
            eligible.length === 0
              ? `No ${type === "CREDIT_CARD" ? "liability" : "asset"} account is free to link — every one is already tied to a bank or card account, or none exist yet in the Chart of Accounts.`
              : "The balance here and the balance sheet are the same number, always."
          }
        >
          <select name="accountId" required disabled={eligible.length === 0} className={clsx(inputClass, "pr-8")}>
            {eligible.map((a) => (
              <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
            ))}
          </select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Opening balance" hint="What the bank statement showed on the opening date, not the GL balance.">
            <input name="openingBalance" defaultValue="0.00" inputMode="decimal" className={clsx(inputClass, "tnum")} />
          </Field>
          <Field label="Opening date">
            <input type="date" name="openingDate" className={inputClass} />
          </Field>
        </div>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || eligible.length === 0}>
            {saving ? "Adding…" : "Add account"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
