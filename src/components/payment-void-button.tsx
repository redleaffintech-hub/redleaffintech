"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Inline void action for a payment-list row — the detail page has its own copy of this same call. */
export function PaymentVoidButton({
  paymentId,
  voidAction,
}: {
  paymentId: string;
  voidAction: (paymentId: string) => Promise<{ error?: string; ok?: boolean }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await voidAction(paymentId);
            if (result?.error) setError(result.error);
            else router.refresh();
          })
        }
        className="text-[0.75rem] font-medium text-muted-ink hover:text-negative disabled:opacity-50"
      >
        {pending ? "Voiding…" : "Void"}
      </button>
      {error && <span className="max-w-[10rem] text-right text-[0.6875rem] text-negative">{error}</span>}
    </span>
  );
}
