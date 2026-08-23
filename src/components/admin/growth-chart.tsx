import { AdminCard } from "./ui";

/**
 * Twelve months of client and subscription starts.
 *
 * A deliberately plain paired bar chart rather than the app's `GroupedBarChart`:
 * that one formats every value as money through the currency context, and these
 * are counts. Baselines share one scale so the two series are comparable, and
 * the value sits above each bar because at this size reading a count off an axis
 * is guesswork.
 */
export function GrowthChart({
  data,
}: {
  data: { month: string; companies: number; subscriptions: number }[];
}) {
  const max = Math.max(1, ...data.map((point) => Math.max(point.companies, point.subscriptions)));
  const hasAny = data.some((point) => point.companies > 0 || point.subscriptions > 0);

  return (
    <AdminCard title="Growth" subtitle="New client companies and subscriptions started, by month">
      {hasAny ? (
        <>
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1" role="img" aria-label="Monthly growth">
            {data.map((point) => (
              <div key={point.month} className="flex min-w-[3.25rem] flex-1 flex-col items-center gap-1.5">
                <div className="flex h-32 w-full items-end justify-center gap-1">
                  <Bar
                    value={point.companies}
                    max={max}
                    color="var(--color-series-1)"
                    title={`${point.companies} client${point.companies === 1 ? "" : "s"} in ${point.month}`}
                  />
                  <Bar
                    value={point.subscriptions}
                    max={max}
                    color="var(--color-series-4)"
                    title={`${point.subscriptions} subscription${point.subscriptions === 1 ? "" : "s"} in ${point.month}`}
                  />
                </div>
                <span className="text-[0.625rem] tabular-nums text-muted-ink">{point.month.slice(2)}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-paper-200 pt-3 text-[0.75rem] text-muted-ink">
            <Key color="var(--color-series-1)" label="New clients" />
            <Key color="var(--color-series-4)" label="New subscriptions" />
          </div>
        </>
      ) : (
        <p className="py-8 text-center text-[0.8125rem] text-muted-ink">
          No clients or subscriptions have been created in the last twelve months.
        </p>
      )}
    </AdminCard>
  );
}

function Bar({ value, max, color, title }: { value: number; max: number; color: string; title: string }) {
  // A zero still gets a hairline, so an empty month reads as "none" rather than
  // as a rendering failure.
  const height = value === 0 ? 2 : Math.max(4, Math.round((value / max) * 112));
  return (
    <div className="flex w-3.5 flex-col items-center justify-end" title={title}>
      {value > 0 && <span className="mb-1 text-[0.625rem] font-medium tabular-nums text-ink-700">{value}</span>}
      <div
        className="w-full rounded-t-sm"
        style={{ height, backgroundColor: value === 0 ? "var(--color-paper-400)" : color }}
      />
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
