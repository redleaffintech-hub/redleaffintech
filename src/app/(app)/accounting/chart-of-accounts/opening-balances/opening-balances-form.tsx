"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { ExportCsvButton } from "@/components/export-csv-button";
import { toCents } from "@/lib/money";
import { useMoney } from "@/components/currency-context";
import { importOpeningBalancesCsvAction, importOpeningBalancesManualAction } from "./actions";

interface AccountOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

const TODAY = new Date().toISOString().slice(0, 10);

export function OpeningBalancesForm({ accounts }: { accounts: AccountOption[] }) {
  const [mode, setMode] = useState<"CSV" | "MANUAL">("CSV");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-paper-300 bg-white p-0.5">
        {(["CSV", "MANUAL"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
              mode === m ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-paper-100",
            )}
          >
            {m === "CSV" ? "Import CSV" : "Enter manually"}
          </button>
        ))}
      </div>

      {mode === "CSV" ? <CsvImport /> : <ManualEntry accounts={accounts} />}
    </div>
  );
}

function CsvImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(TODAY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [imported, setImported] = useState<number | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setWarnings([]);
    setImported(null);
    const content = await file.text();
    const result = await importOpeningBalancesCsvAction(date, content);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";

    if ("error" in result && result.error) {
      setError(result.error);
      setWarnings(result.errors ?? []);
      return;
    }
    if ("ok" in result && result.ok) {
      setImported(result.imported);
      setWarnings(result.errors);
      router.refresh();
    }
  }

  return (
    <section className="rounded-[--radius-card] border border-paper-300 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="As of date" required hint="Posted against Opening Balance Equity as of this date.">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
        <div className="flex items-end">
          <ExportCsvButton report="gl-opening-balances-template" label="Download template" />
        </div>
      </div>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className="mt-4 rounded-lg border border-dashed border-paper-400 px-4 py-6 text-center"
      >
        <Icon name="download" className="mx-auto h-5 w-5 rotate-180 text-ink-300" />
        <p className="mt-2 text-[0.8125rem] text-ink-700">Drop the filled-in template here</p>
        <p className="mt-0.5 text-[0.75rem] text-muted-ink">or</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="mt-2 rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100 disabled:opacity-50"
        >
          {busy ? "Importing…" : "Choose file"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </div>

      {imported !== null && (
        <p className="mt-3 rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">
          Opening balances posted for {imported} account{imported === 1 ? "" : "s"}.
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-md border border-[color:var(--color-caution)]/30 bg-caution-soft px-3 py-2 text-[0.8125rem] text-caution">
          <p className="font-medium">{warnings.length} row{warnings.length === 1 ? "" : "s"} skipped:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

interface ManualLine {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
}

function ManualEntry({ accounts }: { accounts: AccountOption[] }) {
  const money = useMoney();
  const router = useRouter();
  const [date, setDate] = useState(TODAY);
  const [lines, setLines] = useState<ManualLine[]>([
    { key: crypto.randomUUID(), accountId: accounts[0]?.id ?? "", debit: "", credit: "" },
    { key: crypto.randomUUID(), accountId: accounts[1]?.id ?? "", debit: "", credit: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(key: string, patch: Partial<ManualLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  const totals = lines.reduce(
    (acc, l) => ({ debit: acc.debit + safeCents(l.debit), credit: acc.credit + safeCents(l.credit) }),
    { debit: 0, credit: 0 },
  );
  const difference = totals.debit - totals.credit;

  async function submit() {
    setError(null);
    setSaving(true);
    const result = await importOpeningBalancesManualAction(
      JSON.stringify({
        date,
        lines: lines
          .filter((line) => safeCents(line.debit) > 0 || safeCents(line.credit) > 0)
          .map((line) => ({ accountId: line.accountId, debit: line.debit || undefined, credit: line.credit || undefined })),
      }),
    );
    setSaving(false);
    if (result?.error) setError(result.error);
    else if (result?.redirectTo) router.push(result.redirectTo);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[--radius-card] border border-paper-300 bg-white p-5">
        <Field label="As of date" required className="max-w-xs" hint="Any residual is posted to Opening Balance Equity.">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
      </section>

      <section className="rounded-[--radius-card] border border-paper-300 bg-white">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[36rem] text-[0.8125rem]">
            <thead>
              <tr className="border-b border-paper-200">
                <th className="px-2 py-2.5 pl-5 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink">Account</th>
                <th className="px-2 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink" style={{ width: "9rem" }}>Debit</th>
                <th className="px-2 py-2.5 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink" style={{ width: "9rem" }}>Credit</th>
                <th className="px-2 py-2.5 pr-5" style={{ width: "2.5rem" }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="border-b border-paper-100 last:border-0">
                  <td className="px-2 py-1.5 pl-5">
                    <select value={line.accountId} onChange={(event) => update(line.key, { accountId: event.target.value })} className={clsx(inputClass, "pr-7")}>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} · {account.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={line.debit}
                      onChange={(event) => update(line.key, { debit: event.target.value, credit: "" })}
                      inputMode="decimal"
                      placeholder="0.00"
                      className={clsx(inputClass, "tnum text-right")}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      value={line.credit}
                      onChange={(event) => update(line.key, { credit: event.target.value, debit: "" })}
                      inputMode="decimal"
                      placeholder="0.00"
                      className={clsx(inputClass, "tnum text-right")}
                    />
                  </td>
                  <td className="px-2 py-1.5 pr-5">
                    <button
                      type="button"
                      onClick={() => setLines((current) => (current.length <= 1 ? current : current.filter((l) => l.key !== line.key)))}
                      disabled={lines.length <= 1}
                      className="grid h-7 w-7 place-items-center rounded text-ink-400 transition-colors hover:bg-negative-soft hover:text-negative disabled:opacity-30 disabled:hover:bg-transparent"
                      aria-label="Remove line"
                    >
                      <Icon name="x" className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-paper-300">
                <td className="px-2 py-2.5 pl-5 font-medium text-ink-800">Totals</td>
                <td className="tnum px-2 py-2.5 text-right font-semibold text-ink-950">{money.format(totals.debit)}</td>
                <td className="tnum px-2 py-2.5 text-right font-semibold text-ink-950">{money.format(totals.credit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-paper-200 px-5 py-3">
          <Button
            onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), accountId: accounts[0]?.id ?? "", debit: "", credit: "" }])}
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add line
          </Button>

          <span className="text-[0.8125rem] text-muted-ink">
            {difference === 0
              ? "Balanced."
              : `Difference of ${money.format(Math.abs(difference))} will post to Opening Balance Equity.`}
          </span>
        </div>
      </section>

      {error && (
        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Posting…" : "Post opening balances"}
        </Button>
      </div>
    </div>
  );
}

function safeCents(value: string): number {
  if (!value.trim()) return 0;
  try {
    return toCents(value);
  } catch {
    return 0;
  }
}
