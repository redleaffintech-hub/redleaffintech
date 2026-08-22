"use client";

import { useId, useState } from "react";
import clsx from "clsx";
import { formatCompact, formatMoney } from "@/lib/money";

/**
 * Inline-SVG charts.
 *
 * Colours come from the validated palette in globals.css (--color-series-*,
 * --color-age-*). Every multi-series chart carries a legend AND direct value
 * labels, so identity is never colour-alone, and each has a hover layer.
 */

const GRID = "var(--color-grid)";
const AXIS_INK = "var(--color-muted-ink)";

// ── Trend (single series) ───────────────────────────────────────────────────

export interface TrendPoint {
  label: string;
  value: number;
}

export function TrendChart({
  points,
  height = 200,
  seriesLabel = "Cash on hand",
  color = "var(--color-series-1)",
  formatValue = (v: number) => formatMoney(v),
}: {
  points: TrendPoint[];
  height?: number;
  seriesLabel?: string;
  color?: string;
  formatValue?: (value: number) => string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <ChartEmpty height={height} message="Not enough history yet to draw a trend." />;
  }

  const width = 720;
  const pad = { top: 14, right: 16, bottom: 26, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const values = points.map((p) => p.value);
  const { min, max, ticks } = niceScale(Math.min(0, ...values), Math.max(...values));
  const x = (i: number) => pad.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => pad.top + plotH - ((v - min) / (max - min || 1)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(min).toFixed(1)} L${x(0).toFixed(1)},${y(min).toFixed(1)} Z`;

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`${seriesLabel} from ${points[0].label} to ${points[points.length - 1].label}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth="1" />
            <text x={pad.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize="10" fill={AXIS_INK} className="tnum">
              {formatCompact(tick)}
            </text>
          </g>
        ))}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {points.map((point, index) => (
          <text
            key={`${point.label}-x`}
            x={x(index)}
            y={height - 8}
            textAnchor="middle"
            fontSize="10"
            fill={AXIS_INK}
            opacity={points.length > 8 && index % 2 === 1 ? 0 : 1}
          >
            {point.label}
          </text>
        ))}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke={AXIS_INK} strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover].value)} r="5" fill={color} stroke="#fff" strokeWidth="2" />
          </g>
        )}

        {/* Generous invisible hit targets, wider than the marks themselves. */}
        {points.map((point, index) => (
          <rect
            key={`${point.label}-hit`}
            x={x(index) - plotW / (points.length - 1) / 2}
            y={pad.top}
            width={plotW / (points.length - 1)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>

      {hover !== null && (
        <Tooltip
          leftPercent={(x(hover) / width) * 100}
          topPercent={(y(points[hover].value) / height) * 100}
          rows={[{ color, label: seriesLabel, value: formatValue(points[hover].value) }]}
          title={points[hover].label}
        />
      )}
    </figure>
  );
}

// ── Grouped bars (two series) ───────────────────────────────────────────────

export interface GroupedPoint {
  label: string;
  a: number;
  b: number;
}

export function GroupedBarChart({
  points,
  height = 236,
  labelA = "Revenue",
  labelB = "Expenses",
}: {
  points: GroupedPoint[];
  height?: number;
  labelA?: string;
  labelB?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return <ChartEmpty height={height} message="No activity in this period." />;

  const width = 720;
  const pad = { top: 12, right: 12, bottom: 28, left: 54 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { min, max, ticks } = niceScale(0, Math.max(...points.flatMap((p) => [p.a, p.b])));
  const slot = plotW / points.length;
  // 2px surface gap between adjacent bars, thin marks.
  const barW = Math.min(15, (slot - 10) / 2);
  const y = (v: number) => pad.top + plotH - ((v - min) / (max - min || 1)) * plotH;

  return (
    <figure>
      <div className="mb-2 flex items-center gap-4">
        <LegendSwatch color="var(--color-series-1)" label={labelA} />
        <LegendSwatch color="var(--color-series-2)" label={labelB} />
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img"
          aria-label={`${labelA} and ${labelB} by month`} onMouseLeave={() => setHover(null)}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth="1" />
              <text x={pad.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize="10" fill={AXIS_INK} className="tnum">
                {formatCompact(tick)}
              </text>
            </g>
          ))}

          {points.map((point, index) => {
            const centre = pad.left + slot * index + slot / 2;
            return (
              <g key={point.label} opacity={hover === null || hover === index ? 1 : 0.45}>
                <RoundedBar x={centre - barW - 1} y={y(point.a)} width={barW} height={y(min) - y(point.a)} fill="var(--color-series-1)" />
                <RoundedBar x={centre + 1} y={y(point.b)} width={barW} height={y(min) - y(point.b)} fill="var(--color-series-2)" />
                <text x={centre} y={height - 9} textAnchor="middle" fontSize="10" fill={AXIS_INK}>
                  {point.label}
                </text>
                <rect x={pad.left + slot * index} y={pad.top} width={slot} height={plotH} fill="transparent"
                  onMouseEnter={() => setHover(index)} />
              </g>
            );
          })}
        </svg>

        {hover !== null && (
          <Tooltip
            leftPercent={((pad.left + slot * hover + slot / 2) / width) * 100}
            topPercent={(y(Math.max(points[hover].a, points[hover].b)) / height) * 100}
            title={points[hover].label}
            rows={[
              { color: "var(--color-series-1)", label: labelA, value: formatMoney(points[hover].a) },
              { color: "var(--color-series-2)", label: labelB, value: formatMoney(points[hover].b) },
              { color: null, label: "Net", value: formatMoney(points[hover].a - points[hover].b) },
            ]}
          />
        )}
      </div>
    </figure>
  );
}

// ── Aging (ordinal severity ramp) ───────────────────────────────────────────

export function AgingBar({
  buckets,
  total,
}: {
  buckets: { label: string; value: number }[];
  total: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ramp = ["var(--color-age-0)", "var(--color-age-1)", "var(--color-age-2)", "var(--color-age-3)", "var(--color-age-4)"];
  const positive = Math.max(total, 1);

  return (
    <div>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-paper-200" role="img"
        aria-label={buckets.map((b) => `${b.label} ${formatMoney(b.value)}`).join(", ")}>
        {buckets.map((bucket, index) => {
          const share = Math.max(bucket.value, 0) / positive;
          if (share <= 0) return null;
          return (
            <span
              key={bucket.label}
              className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${share * 100}%`,
                background: ramp[Math.min(index, ramp.length - 1)],
                opacity: hover === null || hover === index ? 1 : 0.4,
              }}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </div>

      <ul className="mt-3 grid gap-1.5">
        {buckets.map((bucket, index) => (
          <li
            key={bucket.label}
            className={clsx(
              "flex items-center gap-2 rounded px-1 py-0.5 text-[0.8125rem] transition-colors",
              hover === index && "bg-paper-100",
            )}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: ramp[Math.min(index, ramp.length - 1)] }} />
            <span className="flex-1 text-ink-700">{bucket.label}</span>
            <span className="tnum font-medium text-ink-900">{formatMoney(bucket.value)}</span>
            <span className="tnum w-11 text-right text-[0.75rem] text-muted-ink">
              {total > 0 ? `${Math.round((bucket.value / positive) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────

export function Sparkline({ values, color = "var(--color-series-1)" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const width = 96;
  const height = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden className="overflow-visible">
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

// ── Shared pieces ───────────────────────────────────────────────────────────

/** 4px rounded data-end, square where it meets the baseline. */
function RoundedBar({ x, y, width, height, fill }: { x: number; y: number; width: number; height: number; fill: string }) {
  if (height <= 0.5) return null;
  const r = Math.min(4, width / 2, height);
  return (
    <path
      d={`M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`}
      fill={fill}
    />
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[0.75rem] text-ink-700">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function Tooltip({
  leftPercent,
  topPercent,
  title,
  rows,
}: {
  leftPercent: number;
  topPercent: number;
  title: string;
  rows: { color: string | null; label: string; value: string }[];
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-lg border border-paper-300 bg-white px-2.5 py-2 shadow-[0_8px_24px_-8px_rgba(10,16,32,0.3)]"
      style={{ left: `${Math.min(Math.max(leftPercent, 10), 90)}%`, top: `${topPercent}%` }}
    >
      <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2 whitespace-nowrap text-[0.75rem]">
          {row.color ? (
            <span className="h-2 w-2 rounded-sm" style={{ background: row.color }} />
          ) : (
            <span className="h-2 w-2" />
          )}
          <span className="text-ink-700">{row.label}</span>
          <span className="tnum ml-auto font-medium text-ink-900">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

function ChartEmpty({ height, message }: { height: number; message: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-paper-400 text-[0.8125rem] text-muted-ink" style={{ height }}>
      {message}
    </div>
  );
}

/** Axis ticks on human-readable round numbers. */
function niceScale(rawMin: number, rawMax: number) {
  if (rawMax === rawMin) rawMax = rawMin + 1;
  const range = rawMax - rawMin;
  const step = Math.pow(10, Math.floor(Math.log10(range / 4)));
  const normalized = range / 4 / step;
  const multiplier = normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1;
  const niceStep = step * multiplier;
  const min = Math.floor(rawMin / niceStep) * niceStep;
  const max = Math.ceil(rawMax / niceStep) * niceStep;

  const ticks: number[] = [];
  for (let value = min; value <= max + niceStep / 2; value += niceStep) ticks.push(Math.round(value));
  return { min, max, ticks };
}
