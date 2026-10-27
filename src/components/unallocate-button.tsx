"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unallocatePaymentAction } from "@/app/actions/unallocate";

/** "Unallocate" for one payment allocation on an invoice or bill, with confirmation. */
export function UnallocateButton({ allocationId, paymentNumber, documentNumber, label = "Unallocate" }: { allocationId: string; paymentNumber: string; documentNumber: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="no-print inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`${label} ${paymentNumber} from ${documentNumber}? ${documentNumber} becomes open again and ${paymentNumber} stays as unapplied credit you can apply elsewhere or void.`)) return;
          setError(null);
          startTransition(async () => {
            const result = await unallocatePaymentAction(allocationId);
            if ("error" in result && result.error) setError(result.error);
            else router.refresh();
          });
        }}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative transition-colors hover:bg-negative-soft disabled:opacity-50"
      >
        {pending ? "Working…" : label}
      </button>
      {error && <span className="max-w-[14rem] text-right text-[0.6875rem] text-negative">{error}</span>}
    </span>
  );
}
