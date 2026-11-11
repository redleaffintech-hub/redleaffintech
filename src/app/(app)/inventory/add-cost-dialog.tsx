"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { addInventoryCostAction, reverseInventoryCostAction } from "./actions";
import type { OffsetAccountOption } from "./adjust-stock-dialog";

/** Typical dealership/workshop costs; the field still accepts anything typed. */
const COST_CATEGORIES = [
  "Mechanical repairs",
  "Detailing / car wash",
  "Safety inspection",
  "Fuel",
  "Transport / delivery",
  "Parts",
  "Other qualifying cost",
];

export function AddCostButton({
  itemId,
  itemName,
  accounts,
  className,
}: {
  itemId: string;
  itemName: string;
  accounts: OffsetAccountOption[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"}
      >
        + Add cost
      </button>
      {open && <AddCostDialog itemId={itemId} itemName={itemName} accounts={accounts} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddCostDialog({
  itemId,
  itemName,
  accounts,
  onClose,
}: {
  itemId: string;
  itemName: string;
  accounts: OffsetAccountOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      open
      onClose={onClose}
      title="Add additional cost"
      description={`${itemName} — raises this item's cost without changing its quantity.`}
    >
      <form
        action={async (formData) => {
          setSaving(true);
          setError(null);
          const result = await addInventoryCostAction(
            JSON.stringify({
              itemId,
              date: String(formData.get("date")),
              category: String(formData.get("category")),
              supplier: String(formData.get("supplier") ?? ""),
              reference: String(formData.get("reference") ?? ""),
              amount: String(formData.get("amount")),
              offsetAccountId: String(formData.get("offsetAccountId")),
            }),
          );
          setSaving(false);
          if (result?.error) setError(result.error);
          else {
            onClose();
            router.refresh();
          }
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" required>
            <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} required />
          </Field>
          <Field label="Amount" required hint="Cost before any recoverable tax.">
            <input name="amount" inputMode="decimal" placeholder="0.00" className={clsx(inputClass, "tnum")} required />
          </Field>
        </div>
        <Field label="Cost category" required hint="What the money was spent on.">
          <input name="category" list="inventory-cost-categories" maxLength={80} className={inputClass} placeholder="Mechanical repairs" required />
          <datalist id="inventory-cost-categories">
            {COST_CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier">
            <input name="supplier" maxLength={120} className={inputClass} placeholder="ABC Auto Repair" />
          </Field>
          <Field label="Reference">
            <input name="reference" maxLength={60} className={inputClass} placeholder="Invoice #123" />
          </Field>
        </div>
        <Field label="Paid from" required hint="The other side of the entry — a bank account, or Accounts Payable if it is not paid yet.">
          <select name="offsetAccountId" className={clsx(inputClass, "pr-8")} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} {a.name}</option>
            ))}
          </select>
        </Field>
        <p className="rounded-md bg-paper-100 px-3 py-2 text-[0.75rem] text-muted-ink">
          Posts Dr Inventory / Cr the account above. Only costs needed to bring the item to saleable condition belong here;
          routine selling and admin costs should be expensed instead.
        </p>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : "Add cost"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReverseCostButton({ itemId, movementId }: { itemId: string; movementId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Reverse this cost? The entry stays in the history with an offsetting reversal.")) return;
          setBusy(true);
          setError(null);
          const result = await reverseInventoryCostAction(itemId, movementId);
          setBusy(false);
          if (result?.error) setError(result.error);
          else router.refresh();
        }}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative transition-colors hover:bg-negative-soft disabled:opacity-50"
      >
        Reverse
      </button>
      {error && <span className="max-w-[12rem] text-right text-[0.6875rem] text-negative">{error}</span>}
    </span>
  );
}
