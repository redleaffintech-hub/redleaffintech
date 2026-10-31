"use client";

import { useState } from "react";
import clsx from "clsx";
import { Button, inputClass } from "@/components/ui";
import { RANGE_PRESETS, type RangePreset } from "@/lib/export-ranges";

interface Item {
  key: string;
  label: string;
  kind: "report" | "list";
  disabledReason?: string;
}

/**
 * Same shape as QuickBooks' Export data screen: a Reports tab (with a date range)
 * and a Lists tab, a toggle per item, and one "Export to Excel" button that
 * downloads a zip of .xlsx files.
 */
export function ExportForm({ items }: { items: Item[] }) {
  const [tab, setTab] = useState<"report" | "list">("report");
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(items.filter((i) => !i.disabledReason).map((i) => [i.key, true])));
  const [range, setRange] = useState<RangePreset>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected = items.filter((i) => on[i.key]);
  const needsDates = range === "CUSTOM" && selected.some((i) => i.kind === "report");

  function exportNow() {
    setError(null);
    if (selected.length === 0) return setError("Turn on at least one report or list.");
    if (needsDates && (!from || !to)) return setError("Choose a start and end date for the custom range.");
    const q = new URLSearchParams({ items: selected.map((i) => i.key).join(","), range });
    if (range === "CUSTOM") { q.set("from", from); q.set("to", to); }
    // A file download, not a page: an anchor click lets the browser save the attachment
    // without leaving this screen (and without Next trying to render the route).
    const a = document.createElement("a");
    a.href = `/company/export-data/download?${q.toString()}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const visible = items.filter((i) => i.kind === tab);

  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-paper-300">
        {(["report", "list"] as const).map((t) => (
          <button
            key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)}
            className={clsx("-mb-px border-b-2 px-3 py-2 text-[0.8125rem] font-medium", tab === t ? "border-brand-600 text-ink-900" : "border-transparent text-muted-ink hover:text-ink-800")}
          >
            {t === "report" ? "Reports" : "Lists"}
          </button>
        ))}
      </div>

      {tab === "report" && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="block text-[0.75rem] text-muted-ink">
            Pre-selected date ranges
            <select className={clsx(inputClass, "mt-1 block w-60")} value={range} onChange={(e) => setRange(e.target.value as RangePreset)}>
              {RANGE_PRESETS.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
            </select>
          </label>
          {range === "CUSTOM" && (
            <>
              <label className="block text-[0.75rem] text-muted-ink">From
                <input type="date" className={clsx(inputClass, "mt-1 block")} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="block text-[0.75rem] text-muted-ink">To
                <input type="date" className={clsx(inputClass, "mt-1 block")} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
            </>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {visible.map((item) => (
          <li key={item.key} className="flex items-center justify-between rounded-lg border border-paper-300 bg-white px-4 py-3">
            <div>
              <span className="text-[0.9375rem] text-ink-900">{item.label}</span>
              {item.disabledReason && <p className="text-[0.75rem] text-muted-ink">{item.disabledReason}</p>}
            </div>
            <button
              type="button" role="switch" aria-checked={!!on[item.key]} aria-label={item.label}
              disabled={!!item.disabledReason}
              onClick={() => setOn((s) => ({ ...s, [item.key]: !s[item.key] }))}
              className={clsx("relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40", on[item.key] ? "bg-brand-600" : "bg-paper-400")}
            >
              <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on[item.key] ? "left-[1.375rem]" : "left-0.5")} />
            </button>
          </li>
        ))}
      </ul>

      {error && <p role="alert" className="mt-3 text-[0.8125rem] text-red-700">{error}</p>}
      <div className="mt-6 flex items-center justify-between border-t border-paper-300 pt-4">
        <span className="text-[0.75rem] text-muted-ink">{selected.length} selected · downloads as a .zip of Excel files</span>
        <Button type="button" onClick={exportNow}>Export to Excel</Button>
      </div>
    </div>
  );
}
