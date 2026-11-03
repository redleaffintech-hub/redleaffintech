"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { setOpeningStockAction } from "./actions";

export interface OpeningStockValues {
  dateIso: string;
  quantity: string;
  unitCost: string;
}

export function OpeningStockButton({
  itemId,
  itemName,
  current,
}: {
  itemId: string;
  itemName: string;
  /** The opening stock already on file, if any. */
  current: OpeningStockValues | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
      >
        {current ? "Edit opening" : "Opening stock"}
      </button>
      {open && <OpeningStockDialog itemId={itemId} itemName={itemName} current={current} onClose={() => setOpen(false)} />}
    </>
  );
}

function OpeningStockDialog({
  itemId,
  itemName,
  current,
  onClose,
}: {
  itemId: string;
  itemName: string;
  current: OpeningStockValues | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(current?.dateIso ?? new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState(current?.quantity ?? "");
  const [unitCost, setUnitCost] = useState(current?.unitCost ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const result = await setOpeningStockAction(JSON.stringify({ itemId, date, quantity, unitCost }));
    setSaving(false);
    if (result?.error) setError(result.error);
    else {
      onClose();
      router.refresh();
    }
  }

  return (
    <Modal open onClose={onClose} title={current ? "Edit opening stock" : "Opening stock"} description={itemName}>
      <form action={() => void save()} className="space-y-3">
        <Field label="Opening date" required>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
        </Field>
        <Field label="Opening quantity" required hint="Units on hand at the opening date. Enter 0 to remove the opening stock.">
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" className={clsx(inputClass, "tnum")} placeholder="e.g. 25" required />
        </Field>
        <Field label="Unit cost" required hint="Cost of each unit at the opening date.">
          <input value={unitCost} onChange={(e) => setUnitCost(e.target.value)} inputMode="decimal" className={clsx(inputClass, "tnum")} placeholder="0.00" />
        </Field>
        <p className="rounded-md bg-paper-100 px-3 py-2 text-[0.75rem] text-muted-ink">
          Posts to Inventory Asset against Opening Balance Equity. Editing reverses the earlier opening entry and posts the new
          figures, so the history stays on record.
        </p>
        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save opening stock"}</Button>
        </div>
      </form>
    </Modal>
  );
}
