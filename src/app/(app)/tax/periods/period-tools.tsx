"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { deleteTaxPeriodAction, generateTaxPeriodsAction } from "../actions";

export function GeneratePeriodsForm({ defaultYear }: { defaultYear: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const years = [defaultYear - 1, defaultYear, defaultYear + 1];

  return (
    <Card>
      <CardHeader title="Open a year of periods" subtitle="Match the frequency the CRA assigned" />
      <form
        action={async (formData) => {
          setError(null);
          setMessage(null);
          const result = await generateTaxPeriodsAction(formData);
          if (result?.error) setError(result.error);
          else {
            setMessage(`Opened ${result?.count ?? 0} periods.`);
            router.refresh();
          }
        }}
        className="mt-3 space-y-3"
      >
        <Field label="Calendar year" required>
          <select name="year" className={clsx(inputClass, "pr-8")} defaultValue={String(defaultYear)}>
            {years.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </Field>

        <Field label="Filing frequency" required hint="Quarterly is the common assignment for small filers.">
          <select name="frequency" className={clsx(inputClass, "pr-8")} defaultValue="QUARTERLY">
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="ANNUAL">Annual</option>
          </select>
        </Field>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        {message && <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">{message}</p>}

        <Button type="submit" variant="primary" className="w-full">
          Open periods
        </Button>
      </form>
    </Card>
  );
}

export function DeletePeriodButton({ periodId, periodName }: { periodId: string; periodName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        title={`Delete ${periodName} — it has no tax entries`}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteTaxPeriodAction(periodId);
            if (result?.error) setError(result.error);
            else router.refresh();
          })
        }
        className="text-[0.75rem] text-muted-ink hover:text-negative hover:underline"
      >
        Delete
      </button>
      {error && <span className="text-[0.75rem] text-negative">{error}</span>}
    </>
  );
}
