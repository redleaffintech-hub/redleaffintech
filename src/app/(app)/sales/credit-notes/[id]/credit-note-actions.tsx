"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { voidCreditNoteAction } from "../actions";

export function CreditNoteActions({
  creditNoteId,
  status,
  appliedCents,
}: {
  creditNoteId: string;
  status: string;
  appliedCents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="no-print flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 transition-colors hover:bg-paper-100"
        >
          <Icon name="download" className="h-3.5 w-3.5" />
          Print / PDF
        </button>
        {status !== "VOID" && (
          <Button
            variant="danger"
            disabled={pending || appliedCents !== 0}
            title={appliedCents !== 0 ? "Unapply this credit note before voiding it." : undefined}
            onClick={() =>
              startTransition(async () => {
                const result = await voidCreditNoteAction(creditNoteId);
                if (result?.error) setError(result.error);
                else router.refresh();
              })
            }
          >
            Void
          </Button>
        )}
      </div>
      {error && (
        <p className="mt-2 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}
    </>
  );
}
