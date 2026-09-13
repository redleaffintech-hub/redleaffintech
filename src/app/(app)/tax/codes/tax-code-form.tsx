"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { Dialog } from "@/app/(app)/sales/invoices/[id]/invoice-actions";
import { PROVINCES } from "@/lib/enums";
import { isoDate, today } from "@/lib/dates";
import { addProvincialTaxCodesAction, endDateTaxCodeAction, setDefaultTaxCodeAction, setTaxCodeActiveAction } from "../actions";

/**
 * Tax codes are Red Leaf's own published rates (§7) — a company can activate
 * the codes for a province it now sells or buys into, but it can never define
 * a rate of its own. That used to be possible from a "New tax code" form
 * here; it's gone, and this is what replaced it.
 */
export function AddProvinceCodes({ homeProvince }: { homeProvince: string }) {
  const router = useRouter();
  const [province, setProvince] = useState(() => PROVINCES.find((p) => p.code !== homeProvince)?.code ?? homeProvince);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[] | null>(null);

  return (
    <Card>
      <CardHeader
        title="Tax codes"
        subtitle="Set by Red Leaf, not by this company — activate a province's published rates when you start selling or buying into it."
      />
      <div className="mt-3 space-y-3">
        <div className="flex items-end gap-2">
          <label className="flex-1 text-[0.75rem] font-medium text-ink-700">
            Province
            <select
              value={province}
              onChange={(event) => setProvince(event.target.value)}
              className={clsx(inputClass, "mt-1 pr-8")}
            >
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </label>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => {
              setError(null);
              setAdded(null);
              startTransition(async () => {
                const result = await addProvincialTaxCodesAction(province);
                if (result?.error) setError(result.error);
                else {
                  setAdded(result?.taxCodes?.map((c) => c.code) ?? []);
                  router.refresh();
                }
              });
            }}
          >
            {pending ? "Adding…" : "Add codes"}
          </Button>
        </div>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        {added && (
          <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">
            {added.length > 0 ? `Added ${added.join(", ")}.` : "Those codes already existed."}
          </p>
        )}

        <p className="text-[0.75rem] leading-5 text-muted-ink">
          Every code is one of Red Leaf&rsquo;s own effective-dated rates — the same table platform staff publish from
          and keep current with the CRA and each province. There is no way to type in a custom rate here; if a rate
          you need isn&rsquo;t listed, contact support rather than approximating it.
        </p>
      </div>
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
