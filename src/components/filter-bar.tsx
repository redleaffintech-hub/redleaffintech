"use client";

import { useRef } from "react";
import clsx from "clsx";
import { Icon } from "@/components/shell/icons";
import { inputClass } from "@/components/ui";
import { DateField } from "@/components/date-field";
import { useQueryParams } from "@/components/shell/use-query-params";

export interface FilterTab {
  label: string;
  value: string;
  count?: number;
}

/**
 * URL-driven list filters — the query string is the state, so a filtered list
 * is shareable, bookmarkable and survives a refresh.
 */
export function FilterBar({
  tabs,
  paramName = "status",
  searchPlaceholder,
  extra,
}: {
  tabs: FilterTab[];
  paramName?: string;
  searchPlaceholder?: string;
  extra?: React.ReactNode;
}) {
  const { params, update, pending } = useQueryParams();
  const searchTimer = useRef<number | undefined>(undefined);

  const active = params.get(paramName) ?? "";
  const query = params.get("q") ?? "";

  function setParam(key: string, value: string) {
    update((next) => {
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("page");
    });
  }

  return (
    <div className={clsx("mb-4 flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-paper-300 bg-white p-1">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setParam(paramName, tab.value)}
            className={clsx(
              "rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors",
              active === tab.value ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-paper-200",
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={clsx("tnum ml-1.5 text-[0.75rem]", active === tab.value ? "text-ink-300" : "text-muted-ink")}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {searchPlaceholder && (
        <div className="relative min-w-[14rem] flex-1 sm:max-w-xs">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            defaultValue={query}
            placeholder={searchPlaceholder}
            onChange={(event) => {
              const value = event.target.value;
              window.clearTimeout(searchTimer.current);
              searchTimer.current = window.setTimeout(() => setParam("q", value), 260);
            }}
            className={clsx(inputClass, "pl-8")}
          />
        </div>
      )}

      {extra}
    </div>
  );
}

/** Date-range presets for the report screens. */
export function RangePicker({
  from,
  to,
  presets = true,
}: {
  from: string;
  to: string;
  presets?: boolean;
}) {
  const { update, pending } = useQueryParams();

  function apply(nextFrom: string, nextTo: string) {
    update((next) => {
      next.set("from", nextFrom);
      next.set("to", nextTo);
    });
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const quickRanges: [string, string, string][] = [
    ["This month", iso(new Date(Date.UTC(year, now.getUTCMonth(), 1))), iso(new Date(Date.UTC(year, now.getUTCMonth() + 1, 0)))],
    ["This quarter", iso(new Date(Date.UTC(year, Math.floor(now.getUTCMonth() / 3) * 3, 1))), iso(new Date(Date.UTC(year, Math.floor(now.getUTCMonth() / 3) * 3 + 3, 0)))],
    ["Year to date", `${year}-01-01`, iso(now)],
    ["Last year", `${year - 1}-01-01`, `${year - 1}-12-31`],
  ];

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      {presets && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-paper-300 bg-white p-1">
          {quickRanges.map(([label, rangeFrom, rangeTo]) => (
            <button
              key={label}
              type="button"
              onClick={() => apply(rangeFrom, rangeTo)}
              className={clsx(
                "rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors",
                from === rangeFrom && to === rangeTo ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-paper-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 rounded-lg border border-paper-300 bg-white px-2 py-1">
        {/* A report is always run for *some* period, so an emptied field keeps
            the range it had rather than reporting on nothing. */}
        <DateField
          value={from}
          allowEmpty={false}
          aria-label="From"
          onCommit={(next) => apply(next, to)}
          className="bg-transparent text-[0.8125rem] text-ink-800 focus:outline-none"
        />
        <span className="text-muted-ink">→</span>
        <DateField
          value={to}
          allowEmpty={false}
          aria-label="To"
          onCommit={(next) => apply(from, next)}
          className="bg-transparent text-[0.8125rem] text-ink-800 focus:outline-none"
        />
      </div>
    </div>
  );
}

export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 transition-colors hover:bg-paper-100"
    >
      <Icon name="download" className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/**
 * An *optional* date range for a document list, as `from`/`to` in the query
 * string. Distinct from `RangePicker` above: a report must always be run for
 * some period, whereas a list defaults to showing everything, so this one can be
 * cleared and says so when it is not narrowing anything.
 */
export function DateRangeFilter({ label = "Date range" }: { label?: string }) {
  const { params, update, pending } = useQueryParams();

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const active = Boolean(from || to);

  function apply(nextFrom: string, nextTo: string) {
    update((next) => {
      if (nextFrom) next.set("from", nextFrom);
      else next.delete("from");
      if (nextTo) next.set("to", nextTo);
      else next.delete("to");
      next.delete("page");
    });
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const presets: [string, string, string][] = [
    ["30 days", iso(new Date(now.getTime() - 30 * 86_400_000)), iso(now)],
    ["This month", iso(new Date(Date.UTC(year, month, 1))), iso(new Date(Date.UTC(year, month + 1, 0)))],
    [
      "This quarter",
      iso(new Date(Date.UTC(year, Math.floor(month / 3) * 3, 1))),
      iso(new Date(Date.UTC(year, Math.floor(month / 3) * 3 + 3, 0))),
    ],
    ["Year to date", `${year}-01-01`, iso(now)],
  ];

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-paper-300 bg-white p-1">
        {presets.map(([presetLabel, presetFrom, presetTo]) => (
          <button
            key={presetLabel}
            type="button"
            onClick={() => apply(presetFrom, presetTo)}
            className={clsx(
              "rounded-md px-2 py-1 text-[0.75rem] font-medium transition-colors",
              from === presetFrom && to === presetTo ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-paper-200",
            )}
          >
            {presetLabel}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 rounded-lg border border-paper-300 bg-white px-2 py-1">
        <span className="sr-only">{label}</span>
        <DateField
          value={from}
          max={to || undefined}
          aria-label={`${label} — from`}
          onCommit={(next) => apply(next, to)}
          className="bg-transparent text-[0.8125rem] text-ink-800 focus:outline-none"
        />
        <span className="text-muted-ink">→</span>
        <DateField
          value={to}
          min={from || undefined}
          aria-label={`${label} — to`}
          onCommit={(next) => apply(from, next)}
          className="bg-transparent text-[0.8125rem] text-ink-800 focus:outline-none"
        />
        {active && (
          <button
            type="button"
            onClick={() => apply("", "")}
            aria-label="Clear the date range"
            className="grid h-5 w-5 place-items-center rounded text-ink-400 transition-colors hover:bg-paper-200 hover:text-ink-800"
          >
            <Icon name="x" className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
