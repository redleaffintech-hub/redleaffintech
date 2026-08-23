import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Badge, type Tone } from "@/components/ui";
import { SUBSCRIPTION_STATUS_LABELS, STATUS_TONE, type SubscriptionStatus } from "@/lib/subscriptions";

/**
 * Presentational pieces used only inside the platform-admin portal.
 *
 * The portal is deliberately a different-looking product from the accounting
 * app: darker chrome, a slate surface instead of white paper, and a permanent
 * "platform" marker in the header. An operator should never be a beat unsure
 * about whether the button they are looking at affects one company or all of
 * them, and colour is the fastest way to tell them.
 */

export function AdminPageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumb?: { label: string; href?: string }[];
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-ink-500">
          {breadcrumb.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden>/</span>}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-brand-700 hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-950">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-[0.8125rem] leading-6 text-muted-ink">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function AdminCard({
  children,
  className,
  title,
  subtitle,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className={clsx(
        "rounded-(--radius-card) border border-paper-300 bg-white shadow-[0_1px_2px_rgba(38,50,56,0.04)]",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-paper-200 px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[0.9375rem] font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[0.75rem] leading-5 text-muted-ink">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** A dashboard number. `hint` is the one line of context that stops it being trivia. */
export function StatTile({
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: Tone;
}) {
  const body = (
    <>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p
        className={clsx(
          "tnum mt-1.5 font-display text-[1.75rem] font-semibold leading-none tracking-[-0.02em]",
          tone === "negative" && "text-negative",
          tone === "caution" && "text-caution",
          tone === "positive" && "text-positive",
          (tone === "neutral" || tone === "info" || tone === "accent") && "text-ink-950",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1.5 text-[0.75rem] leading-5 text-muted-ink">{hint}</p>}
    </>
  );

  const className = clsx(
    "block rounded-(--radius-card) border bg-white p-4 shadow-[0_1px_2px_rgba(38,50,56,0.04)]",
    href && "transition-colors hover:border-brand-400 hover:bg-brand-soft/40",
    tone === "negative" ? "border-[color:var(--color-negative)]/25" : "border-paper-300",
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function SubscriptionStatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status as SubscriptionStatus] ?? "neutral";
  const label = SUBSCRIPTION_STATUS_LABELS[status as SubscriptionStatus] ?? status;
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * Marks a value that a platform administrator set by hand, against what the
 * plan says. Overrides must be visible at a glance — an unexplained seat count
 * is how a "billing bug" turns out to have been a favour someone did in 2024.
 */
export function OverrideTag({ reason }: { reason?: string | null }) {
  return (
    <span
      title={reason ?? "Set by a platform administrator"}
      className="inline-flex items-center gap-1 rounded-full bg-caution-soft px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-caution ring-1 ring-inset ring-[color:var(--color-caution)]/25"
    >
      Override
    </span>
  );
}

/** A destructive or access-changing area of a page, visually fenced off. */
export function DangerZone({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-(--radius-card) border border-[color:var(--color-negative)]/25 bg-negative-soft/40">
      <div className="border-b border-[color:var(--color-negative)]/20 px-5 py-3">
        <h2 className="text-[0.9375rem] font-semibold text-negative">{title}</h2>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

export function DefinitionRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-paper-200 py-2 last:border-0">
      <dt className="shrink-0 text-[0.8125rem] text-muted-ink">{label}</dt>
      <dd className="min-w-0 text-right text-[0.8125rem] font-medium text-ink-900">{value}</dd>
    </div>
  );
}

export function EmptyRow({ children, colSpan }: { children: ReactNode; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-[0.8125rem] text-muted-ink">
        {children}
      </td>
    </tr>
  );
}

/**
 * Pagination that keeps every other query parameter.
 *
 * Losing the filter you spent thirty seconds building because you clicked page
 * two is the single most irritating bug a list screen can have.
 */
export function Pagination({
  page,
  pageCount,
  total,
  params,
  basePath,
}: {
  page: number;
  pageCount: number;
  total: number;
  params: Record<string, string | undefined>;
  basePath: string;
}) {
  if (pageCount <= 1) {
    return <p className="text-[0.75rem] text-muted-ink">{total} result{total === 1 ? "" : "s"}</p>;
  }

  const build = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    search.set("page", String(target));
    return `${basePath}?${search.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[0.75rem] text-muted-ink">
        Page {page} of {pageCount} · {total} result{total === 1 ? "" : "s"}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 && (
          <Link
            href={build(page - 1)}
            className="rounded-md border border-paper-400 bg-white px-2.5 py-1.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
          >
            Previous
          </Link>
        )}
        {page < pageCount && (
          <Link
            href={build(page + 1)}
            className="rounded-md border border-paper-400 bg-white px-2.5 py-1.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
          >
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

/** A one-time secret (temporary password, invitation link). Shown, then gone. */
export function OneTimeSecret({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-caution/30 bg-caution-soft px-4 py-3">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-caution">{label}</p>
      <p className="mt-2 break-all rounded-md border border-caution/25 bg-white px-3 py-2 font-mono text-[0.8125rem] text-ink-900">
        {value}
      </p>
      <p className="mt-2 text-[0.75rem] leading-5 text-ink-700">
        {note ?? "Copy it now — it is stored only as a hash and cannot be shown again."}
      </p>
    </div>
  );
}
