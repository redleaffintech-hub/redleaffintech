"use client";

import clsx from "clsx";
import { DateField } from "@/components/date-field";
import { useQueryParams } from "@/components/shell/use-query-params";

/** Single "as at" date control for point-in-time statements. */
export function AsOfPicker({ value, paramName = "asOf" }: { value: string; paramName?: string }) {
  const { update, pending } = useQueryParams();

  function apply(next: string) {
    update((search) => search.set(paramName, next));
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const presets: [string, string][] = [
    ["Today", now.toISOString().slice(0, 10)],
    ["Month end", new Date(Date.UTC(year, now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)],
    ["Last year end", `${year - 1}-12-31`],
  ];

  return (
    <div className={clsx("flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <div className="flex items-center gap-1 rounded-lg border border-paper-300 bg-white p-1">
        {presets.map(([label, date]) => (
          <button
            key={label}
            type="button"
            onClick={() => apply(date)}
            className={clsx(
              "rounded-md px-2.5 py-1 text-[0.8125rem] font-medium transition-colors",
              value === date ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-paper-200",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 rounded-lg border border-paper-300 bg-white px-2.5 py-1.5 text-[0.8125rem]">
        <span className="text-muted-ink">As at</span>
        {/* A statement is always "as at" some date, so clearing the field keeps
            the one it had. */}
        <DateField
          value={value}
          allowEmpty={false}
          aria-label="As at"
          onCommit={apply}
          className="bg-transparent text-ink-800 focus:outline-none"
        />
      </label>
    </div>
  );
}
