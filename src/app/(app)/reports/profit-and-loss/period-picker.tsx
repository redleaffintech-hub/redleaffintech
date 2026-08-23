"use client";

import clsx from "clsx";
import { inputClass } from "@/components/ui";
import { useQueryParams } from "@/components/shell/use-query-params";

/**
 * Which fiscal periods the income statement compares.
 *
 * URL-driven like every other filter in the app, so a four-column comparison is
 * shareable and survives a refresh. `end` is the fiscal year the rightmost
 * column ends in; `periods` is how many columns to show back from there.
 */
export function PeriodPicker({
  endYear,
  count,
  availableYears,
}: {
  endYear: number;
  count: number;
  availableYears: number[];
}) {
  const { params, update, pending } = useQueryParams();

  function set(key: string, value: string) {
    update((next) => {
      next.set(key, value);
    });
  }

  return (
    <div className={clsx("no-print flex flex-wrap items-center gap-2", pending && "opacity-70")}>
      <label className="flex items-center gap-1.5 text-[0.8125rem] text-muted-ink">
        Ending
        <select
          value={String(endYear)}
          onChange={(event) => set("end", event.target.value)}
          className={clsx(inputClass, "w-auto pr-8 text-[0.8125rem]")}
        >
          {availableYears.map((year) => (
            <option key={year} value={year}>FY{year}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[0.8125rem] text-muted-ink">
        Comparing
        <select
          value={String(count)}
          onChange={(event) => set("periods", event.target.value)}
          className={clsx(inputClass, "w-auto pr-8 text-[0.8125rem]")}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>{n} period{n === 1 ? "" : "s"}</option>
          ))}
        </select>
      </label>
      {params.get("q") === null && null}
    </div>
  );
}
