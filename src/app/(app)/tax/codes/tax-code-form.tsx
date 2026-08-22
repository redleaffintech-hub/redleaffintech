"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { Dialog } from "@/app/(app)/sales/invoices/[id]/invoice-actions";
import { isoDate, today } from "@/lib/dates";
import {
  createTaxCodeAction,
  endDateTaxCodeAction,
  setDefaultTaxCodeAction,
  setTaxCodeActiveAction,
} from "../actions";

const KINDS = ["GST", "HST", "PST", "QST", "RST"] as const;

interface ComponentRow {
  key: number;
  kind: string;
  rate: string;
  compound: boolean;
}

export function TaxCodeForm({ province }: { province: string }) {
  const router = useRouter();
  const [treatment, setTreatment] = useState<"STANDARD" | "ZERO_RATED" | "EXEMPT">("STANDARD");
  const [rows, setRows] = useState<ComponentRow[]>([{ key: 1, kind: "GST", rate: "", compound: false }]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(key: number, patch: Partial<ComponentRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <Card>
      <CardHeader title="New tax code" subtitle="Effective-dated, with one row per component" />
      <form
        action={async (formData) => {
          setError(null);
          const result = await createTaxCodeAction(formData);
          if (result?.error) setError(result.error);
          else {
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            setRows([{ key: 1, kind: "GST", rate: "", compound: false }]);
            router.refresh();
          }
        }}
        className="mt-3 space-y-3"
      >
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <Field label="Code" required>
            <input name="code" className={clsx(inputClass, "uppercase")} placeholder="HST-ON" required />
          </Field>
          <Field label="Name" required>
            <input name="name" className={inputClass} placeholder="HST 13% (Ontario)" required />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Jurisdiction" required hint="CA for federal, else the province.">
            <input
              name="jurisdiction"
              defaultValue={province}
              maxLength={2}
              className={clsx(inputClass, "uppercase")}
              required
            />
          </Field>
          <Field label="Effective from" required>
            <input type="date" name="effectiveFrom" defaultValue={isoDate(today())} className={inputClass} required />
          </Field>
        </div>

        <Field label="Treatment">
          <select
            name="treatment"
            value={treatment}
            onChange={(event) => setTreatment(event.target.value as typeof treatment)}
            className={clsx(inputClass, "pr-8")}
          >
            <option value="STANDARD">Standard rated</option>
            <option value="ZERO_RATED">Zero-rated (0%, still reported)</option>
            <option value="EXEMPT">Exempt (no tax, not a supply)</option>
          </select>
        </Field>

        <Field label="Applies to">
          <select name="appliesTo" className={clsx(inputClass, "pr-8")} defaultValue="BOTH">
            <option value="BOTH">Sales and purchases</option>
            <option value="SALES">Sales only</option>
            <option value="PURCHASES">Purchases only</option>
          </select>
        </Field>

        {treatment === "STANDARD" && (
          <div className="rounded-lg border border-paper-300 p-3">
            <p className="mb-2 text-[0.75rem] font-medium text-ink-700">Components</p>
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.key} className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <select
                      name="kind"
                      value={row.kind}
                      onChange={(event) => update(row.key, { kind: event.target.value })}
                      className={clsx(inputClass, "w-[5.5rem] pr-6")}
                    >
                      {KINDS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                    <div className="relative flex-1">
                      <input
                        name="rate"
                        value={row.rate}
                        onChange={(event) => update(row.key, { rate: event.target.value })}
                        inputMode="decimal"
                        placeholder="13"
                        className={clsx(inputClass, "tnum pr-7")}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.75rem] text-muted-ink">
                        %
                      </span>
                    </div>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                        className="text-[0.75rem] text-muted-ink hover:text-negative"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {/* Parallel field so the row index lines up server-side. */}
                  <input type="hidden" name="compound" value={row.compound ? "on" : ""} />
                  {rows.length > 1 && row.key !== rows[0].key && (
                    <label className="flex items-center gap-2 pl-[6rem] text-[0.75rem] text-muted-ink">
                      <input
                        type="checkbox"
                        checked={row.compound}
                        onChange={(event) => update(row.key, { compound: event.target.checked })}
                        className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
                      />
                      Charge on the amount including the tax above
                    </label>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { key: Math.max(...current.map((r) => r.key)) + 1, kind: "PST", rate: "", compound: false },
                ])
              }
              className="mt-2 text-[0.75rem] font-medium text-brand-700 hover:underline"
            >
              + Add component
            </button>
            <p className="mt-2 text-[0.75rem] leading-5 text-muted-ink">
              Rates are stored exactly — 9.975% QST is not rounded. GST, HST and QST are treated as recoverable input
              tax credits; PST and RST are not.
            </p>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        {saved && <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">Tax code created.</p>}

        <Button type="submit" variant="primary" className="w-full">
          Create tax code
        </Button>
      </form>
    </Card>
  );
}

export function TaxCodeRowActions({
  taxCodeId,
  code,
  isActive,
  hasEndDate,
  appliesToSales,
  appliesToPurchases,
  isDefaultSales,
  isDefaultPurchase,
}: {
  taxCodeId: string;
  code: string;
  isActive: boolean;
  hasEndDate: boolean;
  appliesToSales: boolean;
  appliesToPurchases: boolean;
  isDefaultSales: boolean;
  isDefaultPurchase: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menu, setMenu] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ error?: string } | void>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) setError(result.error);
      else {
        setMenu(false);
        setEnding(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => setMenu((open) => !open)}
          className="text-[0.75rem] font-medium text-ink-700 hover:text-brand-700 hover:underline"
        >
          {menu ? "Close" : "Manage"}
        </button>

        {menu && (
          <div className="flex flex-col items-start gap-1 rounded-md border border-paper-300 bg-white p-2 text-[0.75rem] shadow-sm">
            {isActive && appliesToSales && !isDefaultSales && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setDefaultTaxCodeAction(taxCodeId, "SALES"))}
                className="text-ink-700 hover:text-brand-700 hover:underline"
              >
                Default for sales
              </button>
            )}
            {isActive && appliesToPurchases && !isDefaultPurchase && (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setDefaultTaxCodeAction(taxCodeId, "PURCHASES"))}
                className="text-ink-700 hover:text-brand-700 hover:underline"
              >
                Default for purchases
              </button>
            )}
            {!hasEndDate && (
              <button
                type="button"
                onClick={() => setEnding(true)}
                className="text-ink-700 hover:text-brand-700 hover:underline"
              >
                Set end date
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setTaxCodeActiveAction(taxCodeId, !isActive))}
              className={clsx("hover:underline", isActive ? "text-negative" : "text-positive")}
            >
              {isActive ? "Archive" : "Reactivate"}
            </button>
          </div>
        )}

        {error && <span className="text-[0.75rem] text-negative">{error}</span>}
      </div>

      {ending && (
        <Dialog title={`End-date ${code}`} onClose={() => setEnding(false)}>
          <form
            action={(formData) => run(() => endDateTaxCodeAction(taxCodeId, String(formData.get("effectiveTo") ?? "")))}
            className="space-y-3"
          >
            <p className="text-[0.8125rem] leading-6 text-ink-700">
              After this date the code can no longer be used on a new document, and it stops being a default. Documents
              already posted keep the rate they were charged at — this is how a rate change is handled: end-date the old
              code and create its replacement effective the next day.
            </p>
            <Field label="Last day this code applies" required>
              <input type="date" name="effectiveTo" defaultValue={isoDate(today())} className={inputClass} required />
            </Field>
            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setEnding(false)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={pending}>
                Set end date
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
