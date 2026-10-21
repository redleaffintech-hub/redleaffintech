"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Badge, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { PST_REGISTRATIONS } from "@/lib/tax-registration";
import { FILING_FREQUENCY_LABELS, type FilingFrequency } from "@/lib/tax-filing";
import { savePstRegistrationsAction, saveFilingYearAction } from "./actions";

export interface FilingYearRow {
  year: number;
  /** Stored configuration, or null when the year has none yet. */
  applicable: boolean | null;
  frequency: FilingFrequency | null;
  editable: boolean;
  /** Why a row is read-only. */
  lockLabel: string;
}

function YearRow({ row, canEdit, currentYear }: { row: FilingYearRow; canEdit: boolean; currentYear: number }) {
  const router = useRouter();
  const [applicable, setApplicable] = useState(row.applicable ?? true);
  const [frequency, setFrequency] = useState<string>(row.frequency && row.frequency !== "EXEMPT" ? row.frequency : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!row.editable || !canEdit) {
    return (
      <tr className="border-t border-paper-200">
        <td className="py-2 pr-3 font-medium text-ink-900">{row.year}</td>
        <td className="py-2 pr-3 text-ink-700">
          {row.applicable === null ? "Not configured" : row.applicable ? "Applicable" : "Not applicable"}
        </td>
        <td className="py-2 pr-3 text-ink-900">{row.frequency ? FILING_FREQUENCY_LABELS[row.frequency] : "—"}</td>
        <td className="py-2"><Badge tone="neutral">{row.editable ? "View only" : row.lockLabel}</Badge></td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-paper-200 align-top">
      <td className="py-2 pr-3 font-medium text-ink-900">{row.year}</td>
      <td className="py-2 pr-3">
        <select
          value={applicable ? "YES" : "NO"}
          onChange={(event) => setApplicable(event.target.value === "YES")}
          className={clsx(inputClass, "pr-8")}
          aria-label={`GST/HST status for ${row.year}`}
        >
          <option value="YES">Applicable</option>
          <option value="NO">Not applicable</option>
        </select>
      </td>
      <td className="py-2 pr-3">
        <select
          value={applicable ? frequency : "EXEMPT"}
          disabled={!applicable}
          onChange={(event) => setFrequency(event.target.value)}
          className={clsx(inputClass, "pr-8")}
          aria-label={`Filing frequency for ${row.year}`}
        >
          {applicable ? (
            <>
              <option value="">Choose…</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="ANNUAL">Annually</option>
            </>
          ) : (
            <option value="EXEMPT">Exempt</option>
          )}
        </select>
        {error && <p className="mt-1 text-[0.75rem] text-negative">{error}</p>}
      </td>
      <td className="py-2">
        <Button
          variant="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            const result = await saveFilingYearAction(row.year, applicable, applicable ? frequency : "EXEMPT");
            setSaving(false);
            if (result && "error" in result && result.error) return setError(result.error);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
            router.refresh();
          }}
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
        <p className="mt-1 text-[0.6875rem] text-muted-ink">{row.year === currentYear ? "Current year" : "Editable"}</p>
      </td>
    </tr>
  );
}

export function FilingConfigCard({ rows, canEdit, currentYear }: { rows: FilingYearRow[]; canEdit: boolean; currentYear: number }) {
  return (
    <Card className="p-5">
      <CardHeader
        title="GST/HST filing frequency by year"
        subtitle={`Each calendar year (Jan 1 – Dec 31) has its own frequency. The current year and future years can be changed; past years are final.`}
      />
      <div className="thin-scroll mt-3 overflow-x-auto">
        <table className="w-full text-[0.8125rem]">
          <thead>
            <tr className="text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
              <th className="pb-2 pr-3">Year</th>
              <th className="pb-2 pr-3">GST/HST</th>
              <th className="pb-2 pr-3">Frequency</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <YearRow key={`${row.year}-${row.frequency}-${row.applicable}`} row={row} canEdit={canEdit} currentYear={currentYear} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function PstRegistrationsCard({
  values,
  canEdit,
}: {
  values: { bcPstNumber: string; mbRstNumber: string; skPstNumber: string; legacy: string };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Card className="p-5">
      <CardHeader title="Provincial PST registrations" subtitle="All optional — enter only the provinces you are registered in" />
      <form
        action={async (formData) => {
          setError(null);
          const result = await savePstRegistrationsAction(formData);
          if (result?.error) return setError(result.error);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
          router.refresh();
        }}
        className="mt-3 space-y-3"
      >
        {PST_REGISTRATIONS.map((registration) => (
          <Field key={registration.field} label={registration.label}>
            <input
              name={registration.field}
              defaultValue={values[registration.field]}
              disabled={!canEdit}
              maxLength={30}
              placeholder={registration.placeholder}
              className={clsx(inputClass, "tnum")}
            />
          </Field>
        ))}
        {values.legacy && (
          <p className="text-[0.75rem] text-muted-ink">Existing PST number on file: {values.legacy} (not tied to BC, MB or SK).</p>
        )}
        {error && <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>}
        {saved && <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">Saved.</p>}
        {canEdit && <Button type="submit" variant="primary" className="w-full">Save registrations</Button>}
      </form>
    </Card>
  );
}
