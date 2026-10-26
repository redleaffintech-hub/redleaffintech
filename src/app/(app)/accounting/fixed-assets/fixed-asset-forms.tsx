"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { createAssetAction, disposeAssetAction, reverseRunAction, runDepreciationAction, saveCategoryAction } from "./actions";

export interface AccountOption {
  id: string;
  code: string;
  name: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  method: string;
  usefulLifeMonths: number;
  decliningRatePercent: number;
  residualPercent: number;
}

const selectClass = clsx(inputClass, "pr-8");
const today = () => new Date().toISOString().slice(0, 10);

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>
  );
}

/** Add or edit a category and its depreciation policy. */
export function CategoryForm({
  assetAccounts,
  expenseAccounts,
  initial,
  onDone,
}: {
  assetAccounts: AccountOption[];
  expenseAccounts: AccountOption[];
  initial?: {
    id: string;
    name: string;
    assetAccountId: string;
    accumulatedDepreciationAccountId: string;
    depreciationExpenseAccountId: string;
    method: string;
    usefulLifeMonths: number;
    decliningRatePercent: number;
    residualPercent: number;
  };
  onDone?: () => void;
}) {
  const router = useRouter();
  const [method, setMethod] = useState(initial?.method ?? "STRAIGHT_LINE");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await saveCategoryAction(formData);
          if ("error" in result && result.error) setError(result.error);
          else {
            router.refresh();
            onDone?.();
          }
        });
      }}
    >
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Category name" required>
          <input name="name" defaultValue={initial?.name} className={inputClass} placeholder="Office furniture" required />
        </Field>
        <Field label="Asset (cost) account" required>
          <select name="assetAccountId" defaultValue={initial?.assetAccountId} className={selectClass} required>
            <option value="">Choose…</option>
            {assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Accumulated depreciation account" required>
          <select name="accumulatedDepreciationAccountId" defaultValue={initial?.accumulatedDepreciationAccountId} className={selectClass} required>
            <option value="">Choose…</option>
            {assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Depreciation expense account" required hint="Posts to the profit & loss statement.">
          <select name="depreciationExpenseAccountId" defaultValue={initial?.depreciationExpenseAccountId} className={selectClass} required>
            <option value="">Choose…</option>
            {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Depreciation method" required>
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={selectClass}>
            <option value="STRAIGHT_LINE">Straight-line</option>
            <option value="DECLINING_BALANCE">Declining balance</option>
          </select>
        </Field>
        {method === "STRAIGHT_LINE" ? (
          <Field label="Useful life (months)" required>
            <input name="usefulLifeMonths" inputMode="numeric" defaultValue={initial?.usefulLifeMonths ?? 60} className={inputClass} required />
          </Field>
        ) : (
          <Field label="Annual rate (%)" required hint="Applied to net book value each month (rate / 12).">
            <input name="decliningRatePercent" inputMode="decimal" defaultValue={initial?.decliningRatePercent || 30} className={inputClass} required />
          </Field>
        )}
        <Field label="Residual value (% of cost)">
          <input name="residualPercent" inputMode="decimal" defaultValue={initial?.residualPercent ?? 0} className={inputClass} />
        </Field>
      </div>
      <ErrorLine error={error} />
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : initial ? "Save category" : "Add category"}</Button>
    </form>
  );
}

/** Register a fixed asset. */
export function AssetForm({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [migrated, setMigrated] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const category = categories.find((c) => c.id === categoryId);

  return (
    <form
      className="space-y-4"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await createAssetAction(formData);
          if ("error" in result && result.error) setError(result.error);
          else if ("redirectTo" in result && result.redirectTo) router.push(result.redirectTo);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Asset name" required>
          <input name="name" className={inputClass} placeholder="Reception desk" required />
        </Field>
        <Field label="Category" required hint={category ? `${category.method === "STRAIGHT_LINE" ? `Straight-line over ${category.usefulLifeMonths} months` : `Declining balance ${category.decliningRatePercent}% a year`}${category.residualPercent ? `, ${category.residualPercent}% residual` : ""}` : undefined}>
          <select name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={selectClass} required>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Cost" required>
          <input name="cost" inputMode="decimal" className={clsx(inputClass, "tnum")} placeholder="0.00" required />
        </Field>
        <Field label="Acquisition date" required>
          <input name="acquisitionDate" type="date" defaultValue={today()} className={inputClass} required />
        </Field>
        <Field label="In-service date" hint="Depreciation starts here. Defaults to the acquisition date.">
          <input name="inServiceDate" type="date" className={inputClass} />
        </Field>
        <Field label="Residual value" hint="Leave blank to use the category's residual %.">
          <input name="residual" inputMode="decimal" className={clsx(inputClass, "tnum")} placeholder="Category default" />
        </Field>
        <Field label="Vendor">
          <input name="vendorName" className={inputClass} />
        </Field>
        <Field label="Location">
          <input name="location" className={inputClass} />
        </Field>
        <Field label="Serial number">
          <input name="serialNumber" className={inputClass} />
        </Field>
      </div>
      <Field label="Description">
        <input name="description" className={inputClass} />
      </Field>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-paper-300 p-3 text-[0.8125rem] text-ink-800">
        <input type="checkbox" checked={migrated} onChange={(e) => setMigrated(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" />
        <span>
          This asset was bought before I started using these books
          <span className="mt-0.5 block text-[0.75rem] text-muted-ink">Enter the depreciation already taken; monthly depreciation then continues from the next month.</span>
        </span>
      </label>
      {migrated && (
        <div className="grid gap-3 rounded-lg border border-paper-300 p-3 sm:grid-cols-3">
          <Field label="Accumulated depreciation to date">
            <input name="openingAccumulated" inputMode="decimal" className={clsx(inputClass, "tnum")} placeholder="0.00" />
          </Field>
          <Field label="As of date" hint="Usually the last day of the month before your books start.">
            <input name="openingAsOf" type="date" className={inputClass} />
          </Field>
          <label className="flex cursor-pointer items-start gap-2 self-end text-[0.8125rem] text-ink-800">
            <input type="checkbox" name="postOpeningEntry" defaultChecked className="mt-0.5 h-3.5 w-3.5" />
            <span>
              Post the opening entry
              <span className="block text-[0.75rem] text-muted-ink">Dr cost, Cr accumulated depreciation, Cr Opening Balance Equity. Untick if your opening trial balance already holds these balances.</span>
            </span>
          </label>
        </div>
      )}

      <ErrorLine error={error} />
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Add asset"}</Button>
    </form>
  );
}

/** Dispose of / sell an asset. */
export function DisposeForm({
  assetId,
  bankAccounts,
  gainLossAccounts,
}: {
  assetId: string;
  bankAccounts: AccountOption[];
  gainLossAccounts: AccountOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-3"
      action={(formData) => {
        if (!confirm("Dispose of this asset? Depreciation stops and a disposal entry is posted.")) return;
        setError(null);
        startTransition(async () => {
          const result = await disposeAssetAction(formData);
          if ("error" in result && result.error) setError(result.error);
          else router.refresh();
        });
      }}
    >
      <input type="hidden" name="assetId" value={assetId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Disposal date" required>
          <input name="date" type="date" defaultValue={today()} className={inputClass} required />
        </Field>
        <Field label="Proceeds" hint="Zero if scrapped.">
          <input name="proceeds" inputMode="decimal" defaultValue="0.00" className={clsx(inputClass, "tnum")} />
        </Field>
        <Field label="Proceeds received in">
          <select name="proceedsAccountId" className={selectClass}>
            <option value="">— none —</option>
            {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
        <Field label="Gain / loss account" required>
          <select name="gainLossAccountId" className={selectClass} required>
            <option value="">Choose…</option>
            {gainLossAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </Field>
      </div>
      <ErrorLine error={error} />
      <Button type="submit" disabled={pending}>{pending ? "Posting…" : "Dispose asset"}</Button>
    </form>
  );
}

/** Month picker + preview refresh + post. */
export function RunControls({ month, hasItems }: { month: string; hasItems: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(month);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Depreciate through">
          <input type="month" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />
        </Field>
        <Button onClick={() => router.push(`/accounting/fixed-assets/depreciation?month=${value}`)}>Preview</Button>
        <Button
          variant="primary"
          disabled={pending || !hasItems || value !== month}
          onClick={() => {
            if (!confirm(`Post depreciation through ${month}? One balanced journal entry is created and charged to the profit & loss.`)) return;
            setError(null);
            startTransition(async () => {
              const result = await runDepreciationAction(`${month}-01`);
              if ("error" in result && result.error) setError(result.error);
              else router.refresh();
            });
          }}
        >
          {pending ? "Posting…" : "Run depreciation"}
        </Button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

export function ReverseRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative hover:bg-negative-soft disabled:opacity-50"
        onClick={() => {
          if (!confirm("Reverse this depreciation run? Its journal entry is reversed and the charges are removed.")) return;
          setError(null);
          startTransition(async () => {
            const result = await reverseRunAction(runId);
            if ("error" in result && result.error) setError(result.error);
            else router.refresh();
          });
        }}
      >
        Reverse
      </button>
      {error && <span className="max-w-[16rem] text-right text-[0.6875rem] text-negative">{error}</span>}
    </span>
  );
}
