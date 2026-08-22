"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";
import { Dialog } from "@/app/(app)/sales/invoices/[id]/invoice-actions";
import { closePeriodAction, closeYearAction, reopenPeriodAction } from "./actions";

export function PeriodActions({
  periodId,
  periodName,
  status,
  hasFutureOpen,
}: {
  periodId: string;
  periodName: string;
  status: string;
  hasFutureOpen: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "LOCKED") {
    return <span className="text-[0.75rem] text-muted-ink">Locked by year-end</span>;
  }

  if (status === "CLOSED") {
    return (
      <>
        <Button onClick={() => setReopening(true)} className="text-[0.75rem]">
          Reopen
        </Button>
        {reopening && (
          <Dialog title={`Reopen ${periodName}`} onClose={() => setReopening(false)}>
            <form
              action={async (formData) => {
                setError(null);
                const result = await reopenPeriodAction(periodId, String(formData.get("reason") ?? ""));
                if (result?.error) setError(result.error);
                else {
                  setReopening(false);
                  router.refresh();
                }
              }}
              className="space-y-3"
            >
              <p className="text-[0.8125rem] leading-6 text-ink-700">
                Reopening lets new postings land in a period that has already been reported on. The reason below is
                written to the audit log alongside your name and the timestamp.
              </p>
              <Field label="Reason" required>
                <input name="reason" className={inputClass} placeholder="Late vendor bill received for the period" required />
              </Field>
              {error && (
                <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button onClick={() => setReopening(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Reopen period</Button>
              </div>
            </form>
          </Dialog>
        )}
      </>
    );
  }

  return (
    <>
      <Button
        disabled={pending || hasFutureOpen}
        title={hasFutureOpen ? "Close the earlier open periods first." : undefined}
        onClick={() =>
          startTransition(async () => {
            const result = await closePeriodAction(periodId);
            if (result?.error) setError(result.error);
            else router.refresh();
          })
        }
        className="text-[0.75rem]"
      >
        {pending ? "Closing…" : "Close"}
      </Button>
      {error && <span className="ml-2 text-[0.75rem] text-negative">{error}</span>}
    </>
  );
}

export function YearEndButton({ fiscalYear, disabled }: { fiscalYear: number; disabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="primary" disabled={disabled} onClick={() => setOpen(true)}>
        Run year-end close
      </Button>
      {open && (
        <Dialog title={`Close fiscal ${fiscalYear}`} onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <p className="text-[0.8125rem] leading-6 text-ink-700">
              This posts a closing journal entry dated the last day of the fiscal year that zeroes every revenue and
              expense account against Retained Earnings, then locks all twelve periods. Locked periods cannot be
              reopened.
            </p>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await closeYearAction(fiscalYear);
                    if (result?.error) setError(result.error);
                    else if (result?.redirectTo) router.push(result.redirectTo);
                  })
                }
              >
                {pending ? "Closing…" : "Close the year"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
