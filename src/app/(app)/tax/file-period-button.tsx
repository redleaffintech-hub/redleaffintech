"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { Dialog } from "@/app/(app)/sales/invoices/[id]/invoice-actions";
import { formatMoney } from "@/lib/money";
import { setTaxPeriodStatusAction } from "./actions";

/**
 * Moves a filing period along OPEN → REVIEW → FILED → CLOSED. Each step says
 * plainly what it does to the books: nothing here posts a journal entry, and
 * marking a period filed records the net figure that was submitted so a later
 * reassessment can be compared against it.
 */
export function FilePeriodButton({
  periodId,
  periodName,
  status,
  netCents,
}: {
  periodId: string;
  periodName: string;
  status: string;
  netCents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"file" | "lock" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const payable = netCents >= 0;

  function move(next: string, filingReference?: string) {
    setError(null);
    startTransition(async () => {
      const result = await setTaxPeriodStatusAction(periodId, next, filingReference);
      if (result?.error) setError(result.error);
      else {
        setDialog(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {status === "OPEN" && (
          <Button variant="primary" disabled={pending} onClick={() => move("REVIEW")}>
            {pending ? "Working…" : "Mark ready for review"}
          </Button>
        )}

        {status === "REVIEW" && (
          <>
            <Button disabled={pending} onClick={() => move("OPEN")}>
              Reopen
            </Button>
            <Button variant="primary" onClick={() => setDialog("file")}>
              Record filing
            </Button>
          </>
        )}

        {status === "FILED" && (
          <Button variant="primary" onClick={() => setDialog("lock")}>
            Lock period
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-2 w-full rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      {dialog === "file" && (
        <Dialog title={`Record the filing for ${periodName}`} onClose={() => setDialog(null)}>
          <form
            action={(formData) => move("FILED", String(formData.get("filingReference") ?? ""))}
            className="space-y-3"
          >
            <p className="text-[0.8125rem] leading-6 text-ink-700">
              This records that the return was submitted and stores the{" "}
              {payable ? "net tax payable" : "net refund"} of{" "}
              <span className="font-semibold text-ink-900">{formatMoney(Math.abs(netCents))}</span> against the period.
              It does not post the remittance — enter the payment to the CRA as an expense or bank transaction when the
              money actually moves.
            </p>
            <Field
              label="CRA confirmation number"
              hint="Optional, but it is what ties this period back to the filed return."
            >
              <input name="filingReference" className={inputClass} placeholder="e.g. 1234567890123" />
            </Field>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Recording…" : "Mark as filed"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "lock" && (
        <Dialog title={`Lock ${periodName}`} onClose={() => setDialog(null)}>
          <div className="space-y-3">
            <p className="text-[0.8125rem] leading-6 text-ink-700">
              Locking closes the filing period for good. The working paper stays readable, but the period can never be
              moved back to open — if the CRA reassesses, record the adjustment in a later period rather than
              rewriting this one.
            </p>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="primary" disabled={pending} onClick={() => move("CLOSED")}>
                {pending ? "Locking…" : "Lock the period"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
