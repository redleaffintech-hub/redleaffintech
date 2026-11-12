"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { reverseInventoryCostAction } from "./actions";

/**
 * "+ Add cost" opens the bill form with the lines tied to this item as cost-only, so the supplier,
 * tax, dates and journal preview all work as on any bill but the quantity on hand never changes.
 */
export function AddCostButton({ itemId, className }: { itemId: string; className?: string }) {
  return (
    <Link
      href={`/purchases/bills/new?costItem=${encodeURIComponent(itemId)}`}
      className={className ?? "rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"}
    >
      + Add cost
    </Link>
  );
}

/** Reverses a cost entered with the earlier quick-add dialog. Bill-based costs are undone by voiding the bill. */
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
