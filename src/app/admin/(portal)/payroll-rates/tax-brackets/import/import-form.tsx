"use client";

import { useRouter } from "next/navigation";
import { AdminField, AdminForm, SubmitButton, adminTextareaClass } from "@/components/admin/forms";
import { importBracketsAction } from "./actions";

const SAMPLE = `jurisdiction,effectiveFrom,effectiveTo,min,max,rate,basicPersonalAmount
FEDERAL,2026-01-01,,0,58524,15,16573
FEDERAL,2026-01-01,,58524,117047,20.5,16573
ON,2026-01-01,,0,53500,5.05,12874`;

export function BracketImportForm({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();

  return (
    <AdminForm
      action={importBracketsAction}
      csrfToken={csrfToken}
      onSuccess={() => {
        router.push("/admin/payroll-rates/tax-brackets");
        router.refresh();
      }}
    >
      <div className="space-y-4">
        <AdminField
          label="CSV file"
          hint="Header row: jurisdiction,effectiveFrom,effectiveTo,min,max,rate,basicPersonalAmount. Leave effectiveTo blank only for the most recent, ongoing set in the file."
        >
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-[0.8125rem] text-ink-700 file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-paper-200 file:px-3.5 file:text-[0.8125rem] file:font-medium file:text-ink-800 hover:file:bg-paper-300"
          />
        </AdminField>

        <AdminField label="…or paste CSV text" hint="Used only if no file is chosen above.">
          <textarea name="csv" rows={6} className={`${adminTextareaClass} font-mono`} placeholder={SAMPLE} />
        </AdminField>

        <AdminField label="Reason" required hint="Why this batch is being published. Written to the platform audit log.">
          <textarea name="reason" rows={2} required className={adminTextareaClass} placeholder="CRA/provincial published brackets, 2022–2026 backfill." />
        </AdminField>

        <details className="rounded-lg border border-paper-300 bg-paper-100 px-4 py-3 text-[0.8125rem] text-ink-700">
          <summary className="cursor-pointer font-medium text-ink-800">Example</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre text-[0.75rem] leading-6 text-ink-600">{SAMPLE}</pre>
        </details>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <SubmitButton tone="primary" pendingLabel="Importing…">Import brackets</SubmitButton>
      </div>
    </AdminForm>
  );
}
