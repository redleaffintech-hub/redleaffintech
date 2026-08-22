"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { formatMoney, toCents } from "@/lib/money";
import { postJournalAction } from "../actions";

interface Line {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

/**
 * Manual journal entry. The balance indicator is live, and the submit button
 * stays disabled until debits equal credits — the same rule the posting engine
 * enforces server-side, surfaced before the round trip.
 */
export function JournalForm({
  accounts,
  canPostAdjusting,
}: {
  accounts: { id: string; code: string; name: string; type: string }[];
  canPostAdjusting: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { key: crypto.randomUUID(), accountId: accounts[0]?.id ?? "", debit: "", credit: "", description: "" },
    { key: crypto.randomUUID(), accountId: accounts[1]?.id ?? "", debit: "", credit: "", description: "" },
  ]);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + safeCents(l.debit), 0);
    const credit = lines.reduce((s, l) => s + safeCents(l.credit), 0);
    return { debit, credit, difference: debit - credit };
  }, [lines]);

  const balanced = totals.difference === 0 && totals.debit > 0;

  function update(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function submit() {
    setError(null);
    setSaving(true);
    const result = await postJournalAction(
      JSON.stringify({
        date,
        memo,
        isAdjusting,
        lines: lines
          .filter((line) => safeCents(line.debit) > 0 || safeCents(line.credit) > 0)
          .map((line) => ({
            accountId: line.accountId,
            debit: line.debit || undefined,
            credit: line.credit || undefined,
            description: line.description || undefined,
          })),
      }),
    );
    setSaving(false);
    if (result?.error) setError(result.error);
    else if (result?.redirectTo) router.push(result.redirectTo);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[--radius-card] border border-paper-300 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" required>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Memo" required className="sm:col-span-2" hint="Explain why this entry exists — it is the first thing a reviewer reads.">
            <input value={memo} onChange={(event) => setMemo(event.target.value)} className={inputClass} placeholder="Accrue August contractor costs" />
          </Field>
        </div>

        {canPostAdjusting && (
          <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-paper-300 p-3">
            <input
              type="checkbox"
              checked={isAdjusting}
              onChange={(event) => setIsAdjusting(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
            />
            <span className="text-[0.8125rem] leading-5 text-ink-800">
              Adjusting entry
              <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
                Flags the entry for the client and, as the external accountant, lets it post into a closed period.
                Locked periods still reject it.
              </span>
            </span>
          </label>
        )}
      </section>

      <section className="rounded-[--radius-card] border border-paper-300 bg-white">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[46rem] text-[0.8125rem]">
            <thead>
              <tr className="border-b border-paper-200">
                <th className="px-2 py-2.5 pl-5 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink" style={{ width: "18rem" }}>Account</th>
                <th className="px-2 py-2.5 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink">Description</th>
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
                    <input value={line.description} onChange={(event) => update(line.key, { description: event.target.value })} className={inputClass} placeholder="Optional line note" />
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
                      onClick={() => setLines((current) => (current.length <= 2 ? current : current.filter((l) => l.key !== line.key)))}
                      disabled={lines.length <= 2}
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
                <td colSpan={2} className="px-2 py-2.5 pl-5 font-medium text-ink-800">Totals</td>
                <td className="tnum px-2 py-2.5 text-right font-semibold text-ink-950">{formatMoney(totals.debit)}</td>
                <td className="tnum px-2 py-2.5 text-right font-semibold text-ink-950">{formatMoney(totals.credit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-paper-200 px-5 py-3">
          <Button
            onClick={() =>
              setLines((current) => [
                ...current,
                { key: crypto.randomUUID(), accountId: accounts[0]?.id ?? "", debit: "", credit: "", description: "" },
              ])
            }
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add line
          </Button>

          <span
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] font-medium",
              balanced ? "bg-positive-soft text-positive" : "bg-caution-soft text-caution",
            )}
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", balanced ? "bg-positive" : "bg-caution")} />
            {balanced
              ? "Balanced"
              : totals.debit === 0 && totals.credit === 0
                ? "Enter amounts"
                : `Out of balance by ${formatMoney(Math.abs(totals.difference))}`}
          </span>
        </div>
      </section>

      {error && (
        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={submit} disabled={!balanced || !memo.trim() || saving}>
          {saving ? "Posting…" : "Post entry"}
        </Button>
        <a href="/accounting/journals" className="inline-flex items-center rounded-md border border-paper-400 px-3 py-1.5 text-[0.8125rem] text-ink-700 hover:bg-paper-100">
          Cancel
        </a>
        <p className="ml-auto text-[0.75rem] text-muted-ink">
          Once posted, this entry cannot be edited — corrections are made by reversing it.
        </p>
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
