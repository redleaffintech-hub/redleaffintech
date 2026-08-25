"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { useMoney } from "@/components/currency-context";
import { adjustStockAction } from "./actions";

export interface OffsetAccountOption {
  id: string;
  code: string;
  name: string;
}

export function AdjustStockButton({
  itemId,
  itemName,
  averageCostCents,
  accounts,
}: {
  itemId: string;
  itemName: string;
  averageCostCents: number;
  accounts: OffsetAccountOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
      >
        Adjust stock
      </button>
      {open && (
        <AdjustStockDialog
          itemId={itemId}
          itemName={itemName}
          averageCostCents={averageCostCents}
          accounts={accounts}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AdjustStockDialog({
  itemId,
  itemName,
  averageCostCents,
  accounts,
  onClose,
}: {
  itemId: string;
  itemName: string;
  averageCostCents: number;
  accounts: OffsetAccountOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const money = useMoney();
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const qty = Number(quantity);
  const increasing = Number.isFinite(qty) && qty > 0;

  return (
    <Modal open onClose={onClose} title="Adjust stock" description={itemName}>
      <form
        action={async (formData) => {
          setSaving(true);
          setError(null);
          const result = await adjustStockAction(
            JSON.stringify({
              itemId,
              date: String(formData.get("date")),
              quantity,
              unitCost: increasing ? unitCost : undefined,
              offsetAccountId: String(formData.get("offsetAccountId")),
              reason: String(formData.get("reason")),
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
        <Field label="Quantity" required hint="Positive to receive stock, negative to remove it.">
          <input
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            placeholder="e.g. 10 or -2"
            className={clsx(inputClass, "tnum")}
          />
        </Field>
        {increasing ? (
          <Field label="Unit cost" required hint="What each unit is being added at.">
            <input
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className={clsx(inputClass, "tnum")}
            />
          </Field>
        ) : (
          qty < 0 && (
            <p className="rounded-md bg-paper-100 px-3 py-2 text-[0.75rem] text-muted-ink">
              Removed at the current average cost of {money.format(averageCostCents)} per unit.
            </p>
          )
        )}
        <Field label="Date" required>
          <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} required />
        </Field>
        <Field label="Offset account" required hint="The other side of the entry — Opening Balance Equity for an initial count, an expense account for shrinkage.">
          <select name="offsetAccountId" className={clsx(inputClass, "pr-8")} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} {a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Reason" required>
          <input name="reason" maxLength={200} className={inputClass} placeholder="Initial stock count" required />
        </Field>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : "Adjust stock"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
