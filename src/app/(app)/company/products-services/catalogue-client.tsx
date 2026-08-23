"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { Icon } from "@/components/shell/icons";
import { ITEM_TYPES, ITEM_TYPE_LABELS, itemUnitLabel, type ItemType } from "@/lib/enums";
import { currencySymbol } from "@/lib/money";
import { createItemAction, deleteItemAction, setItemActiveAction, updateItemAction } from "./actions";

export interface CatalogueOptions {
  incomeAccounts: { id: string; code: string; name: string }[];
  expenseAccounts: { id: string; code: string; name: string }[];
  taxCodes: { id: string; code: string; name: string }[];
  units: string[];
  currency: string;
}

export interface CatalogueItem {
  id: string;
  type: string;
  code: string;
  name: string;
  description: string;
  unit: string;
  unitPriceCents: number;
  discountPercentMicro: number;
  incomeAccountId: string;
  expenseAccountId: string;
  taxCodeId: string;
  purchaseTaxCodeId: string;
  isActive: boolean;
}

const BLANK: CatalogueItem = {
  id: "",
  type: "SERVICE",
  code: "",
  name: "",
  description: "",
  unit: "hour",
  unitPriceCents: 0,
  discountPercentMicro: 0,
  incomeAccountId: "",
  expenseAccountId: "",
  taxCodeId: "",
  purchaseTaxCodeId: "",
  isActive: true,
};

export function NewItemButton({ options }: { options: CatalogueOptions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Icon name="plus" className="h-3.5 w-3.5" />
        Add product or service
      </Button>
      {open && <ItemDialog item={BLANK} options={options} onClose={() => setOpen(false)} />}
    </>
  );
}

export function CatalogueRowActions({
  item,
  options,
  usedOnDocuments,
}: {
  item: CatalogueItem;
  options: CatalogueOptions;
  usedOnDocuments: number;
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
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => setItemActiveAction(item.id, !item.isActive))}
          className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200 disabled:opacity-50"
        >
          {item.isActive ? "Archive" : "Reactivate"}
        </button>
        {/* Deleting is offered only when nothing references the item. Anything
            that has been used is archived instead, so historical documents keep
            pointing at something real. */}
        {usedOnDocuments === 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Delete ${item.code} — ${item.name}? It has never been used on a document, so this is permanent.`)) return;
              void run(() => deleteItemAction(item.id));
            }}
            className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative transition-colors hover:bg-negative-soft disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </span>
      {usedOnDocuments > 0 && (
        <span className="text-[0.6875rem] text-muted-ink">
          on {usedOnDocuments} document{usedOnDocuments === 1 ? "" : "s"}
        </span>
      )}
      {error && <span className="max-w-[16rem] text-right text-[0.6875rem] text-negative">{error}</span>}
      {editing && <ItemDialog item={item} options={options} onClose={() => setEditing(false)} />}
    </span>
  );
}

function ItemDialog({
  item,
  options,
  onClose,
}: {
  item: CatalogueItem;
  options: CatalogueOptions;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [type, setType] = useState<string>(item.type);
  const isNew = item.id === "";

  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? "New product or service" : `Edit ${item.code}`}>
      <form
        action={async (formData) => {
          setSaving(true);
          setError(null);
          const result = isNew
            ? await createItemAction(formData)
            : await updateItemAction(item.id, formData);
          setSaving(false);
          const failed = "error" in result ? result.error : null;
          if (failed) setError(failed);
          else {
            onClose();
            router.refresh();
          }
        }}
        className="space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Type" required>
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={clsx(inputClass, "pr-8")}
              required
            >
              {ITEM_TYPES.map((value) => (
                <option key={value} value={value}>{ITEM_TYPE_LABELS[value as ItemType]}</option>
              ))}
            </select>
          </Field>
          <Field label="Code / SKU" required hint="Unique within this company.">
            <input name="code" defaultValue={item.code} maxLength={40} required className={clsx(inputClass, "uppercase tnum")} placeholder="CONSULT-01" />
          </Field>
          <Field label="Unit">
            <select name="unit" defaultValue={item.unit} className={clsx(inputClass, "pr-8")}>
              {options.units.map((unit) => (
                <option key={unit} value={unit}>{itemUnitLabel(unit)}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Name" required>
          <input name="name" defaultValue={item.name} maxLength={120} required className={inputClass} placeholder="Business consulting" />
        </Field>

        <Field label="Description" hint="Copied into the document line, where it can still be edited.">
          <textarea name="description" defaultValue={item.description} rows={2} maxLength={500} className={inputClass} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`List price (${options.currency})`} hint="A default. Any document can charge something else.">
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[0.8125rem] text-muted-ink">
                {currencySymbol(options.currency)}
              </span>
              <input
                name="unitPrice"
                defaultValue={(item.unitPriceCents / 100).toFixed(2)}
                inputMode="decimal"
                className={clsx(inputClass, "tnum pl-6")}
              />
            </div>
          </Field>
          <Field label="Default discount (%)" hint="0 to 100. Overridable per line.">
            <input
              name="discountPercent"
              defaultValue={String(item.discountPercentMicro / 1_000_000)}
              type="number"
              min={0}
              max={100}
              step="0.01"
              className={clsx(inputClass, "tnum")}
            />
          </Field>
        </div>

        <div className="grid gap-3 border-t border-paper-200 pt-4 sm:grid-cols-2">
          <Field label="Sales / income account" hint="Used on invoices, quotes and credit notes.">
            <select name="incomeAccountId" defaultValue={item.incomeAccountId} className={clsx(inputClass, "pr-8")}>
              <option value="">— none —</option>
              {options.incomeAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} {a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Purchase / expense account" hint="Used on bills. Never used on a sales document.">
            <select name="expenseAccountId" defaultValue={item.expenseAccountId} className={clsx(inputClass, "pr-8")}>
              <option value="">— none —</option>
              {options.expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.code} {a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Sales tax code" hint="Place-of-supply rules still apply on the document.">
            <select name="taxCodeId" defaultValue={item.taxCodeId} className={clsx(inputClass, "pr-8")}>
              <option value="">— none —</option>
              {options.taxCodes.map((t) => (
                <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Purchase tax code" hint="Falls back to the sales code when left blank.">
            <select name="purchaseTaxCodeId" defaultValue={item.purchaseTaxCodeId} className={clsx(inputClass, "pr-8")}>
              <option value="">— none —</option>
              {options.taxCodes.map((t) => (
                <option key={t.id} value={t.id}>{t.code} — {t.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-paper-300 p-3">
          <input type="checkbox" name="isActive" defaultChecked={item.isActive} className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-brand-600)]" />
          <span className="text-[0.8125rem] leading-5 text-ink-800">
            Active
            <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
              Inactive items are hidden when writing a new document. Documents that already use them are unaffected.
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
            {saving ? "Saving…" : isNew ? "Add item" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
