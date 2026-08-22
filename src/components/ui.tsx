import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatMoney } from "@/lib/money";

// ── Surfaces ────────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={clsx(
        "rounded-(--radius-card) border border-paper-300 bg-white shadow-[0_1px_2px_rgba(38,50,56,0.04),0_8px_24px_-16px_rgba(38,50,56,0.18)]",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[0.8125rem] leading-5 text-muted-ink">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: string;
  description?: ReactNode;
  breadcrumb?: { label: string; href?: string }[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="mb-1.5 flex items-center gap-1.5 text-[0.75rem] text-muted-ink">
            {breadcrumb.map((crumb, index) => (
              <span key={crumb.label} className="flex items-center gap-1.5">
                {index > 0 && <span className="text-paper-400">/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-ink-800 hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  crumb.label
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[1.5rem] font-semibold leading-8 tracking-[-0.02em] text-ink-950">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[0.875rem] leading-6 text-muted-ink">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-[0_1px_2px_rgba(30,70,100,0.3)]",
  secondary: "bg-white text-ink-800 border border-paper-400 hover:bg-paper-100 hover:border-ink-300",
  ghost: "text-ink-700 hover:bg-paper-200",
  danger: "bg-white text-negative border border-[color:var(--color-negative)]/30 hover:bg-negative-soft",
};

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  children,
  variant = "secondary",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button type={type} className={clsx(BUTTON_BASE, BUTTON_STYLES[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  href,
  variant = "secondary",
  className,
}: {
  children: ReactNode;
  href: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <Link href={href} className={clsx(BUTTON_BASE, BUTTON_STYLES[variant], className)}>
      {children}
    </Link>
  );
}

// ── Status ──────────────────────────────────────────────────────────────────

const TONE_STYLES = {
  neutral: "bg-paper-200 text-ink-700 ring-paper-400",
  info: "bg-info-soft text-info ring-[color:var(--color-info)]/20",
  positive: "bg-positive-soft text-positive ring-[color:var(--color-positive)]/20",
  caution: "bg-caution-soft text-caution ring-[color:var(--color-caution)]/25",
  negative: "bg-negative-soft text-negative ring-[color:var(--color-negative)]/20",
  accent: "bg-maple-50 text-maple-600 ring-maple-200",
} as const;

export type Tone = keyof typeof TONE_STYLES;

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.04em] ring-1 ring-inset",
        TONE_STYLES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const DOCUMENT_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SENT: "info",
  OPEN: "info",
  PARTIALLY_PAID: "caution",
  PARTIALLY_APPLIED: "caution",
  AWAITING_APPROVAL: "caution",
  PAID: "positive",
  APPLIED: "positive",
  OVERDUE: "negative",
  VOID: "neutral",
  POSTED: "positive",
  REVERSED: "neutral",
  ACCEPTED: "positive",
  DECLINED: "negative",
  CONVERTED: "info",
  EXPIRED: "neutral",
  UNMATCHED: "caution",
  CATEGORIZED: "info",
  MATCHED: "info",
  RECONCILED: "positive",
  TRANSFER: "neutral",
  EXCLUDED: "neutral",
  CREDIT: "info",
  CLOSED: "neutral",
  LOCKED: "negative",
  REVIEW: "caution",
  FILED: "positive",
  IN_PROGRESS: "caution",
  COMPLETED: "positive",
  ACTIVE: "positive",
  TRIALING: "info",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={DOCUMENT_STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ").toLowerCase()}</Badge>
  );
}

// ── Money ───────────────────────────────────────────────────────────────────

/**
 * `showCurrency` is off by default: inside a ledger or report every column is
 * already in the company's currency, so repeating the symbol on every row is
 * noise. That is also why `currency` is optional — it only changes the output
 * when a symbol is actually printed. Pass `currency={company.baseCurrency}`
 * whenever `showCurrency` is set, or the symbol falls back to CAD.
 */
export function Money({
  cents,
  className,
  showCurrency = false,
  colorNegative = false,
  bold = false,
  blankZero = false,
  currency,
}: {
  cents: number;
  className?: string;
  showCurrency?: boolean;
  colorNegative?: boolean;
  bold?: boolean;
  blankZero?: boolean;
  currency?: string;
}) {
  return (
    <span
      className={clsx(
        "tnum",
        bold && "font-semibold",
        colorNegative && cents < 0 && "text-negative",
        className,
      )}
    >
      {formatMoney(cents, { showCurrency, accountingNegative: true, blankZero, currency })}
    </span>
  );
}

// ── Tables ──────────────────────────────────────────────────────────────────

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("thin-scroll -mx-5 overflow-x-auto px-5", className)}>
      <table className="w-full min-w-full border-collapse text-[0.8125rem]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className,
  width,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  width?: string;
}) {
  return (
    <th
      style={width ? { width } : undefined}
      className={clsx(
        "border-b border-paper-300 pb-2 pt-1 pr-4 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink last:pr-0",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className,
  colSpan,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={clsx(
        "border-b border-paper-200 py-2.5 pr-4 align-middle text-ink-800 last:pr-0",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  if (href) {
    return (
      <tr className={clsx("group cursor-pointer transition-colors hover:bg-paper-100", className)}>
        {children}
      </tr>
    );
  }
  return <tr className={clsx("transition-colors hover:bg-paper-100", className)}>{children}</tr>;
}

/** A cell whose entire area is a link, so table rows stay keyboard-navigable. */
export function LinkCell({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={clsx("block font-medium text-ink-900 hover:text-brand-700 hover:underline", className)}>
      {children}
    </Link>
  );
}

// ── States ──────────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-ink-300">{icon}</div>}
      <div>
        <p className="text-[0.9375rem] font-semibold text-ink-800">{title}</p>
        {description && <p className="mx-auto mt-1 max-w-md text-[0.8125rem] leading-6 text-muted-ink">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const border = {
    neutral: "border-paper-400 bg-paper-100",
    info: "border-[color:var(--color-info)]/25 bg-info-soft",
    positive: "border-[color:var(--color-positive)]/25 bg-positive-soft",
    caution: "border-[color:var(--color-caution)]/30 bg-caution-soft",
    negative: "border-[color:var(--color-negative)]/25 bg-negative-soft",
    accent: "border-maple-200 bg-maple-50",
  }[tone];

  return (
    <div className={clsx("flex items-start justify-between gap-4 rounded-lg border px-4 py-3", border)}>
      <div className="min-w-0">
        <p className="text-[0.8125rem] font-semibold text-ink-900">{title}</p>
        {children && <div className="mt-0.5 text-[0.8125rem] leading-6 text-ink-700">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ── Forms ───────────────────────────────────────────────────────────────────

export function Field({
  label,
  children,
  hint,
  className,
  required,
  action,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
  required?: boolean;
  /** Optional control rendered opposite the label — "Forgot password?" and the like. */
  action?: ReactNode;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[0.75rem] font-medium text-ink-700">
          {label}
          {required && <span className="ml-0.5 text-maple-500">*</span>}
        </span>
        {action}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[0.75rem] leading-5 text-muted-ink">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-paper-400 bg-white px-2.5 py-1.5 text-[0.8125rem] text-ink-900 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputClass, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputClass, "pr-8", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputClass, props.className)} />;
}

// ── Layout helpers ──────────────────────────────────────────────────────────

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{item.label}</dt>
          <dd className="mt-0.5 text-[0.8125rem] text-ink-900">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-ink">{label}</span>
      <span className="h-px flex-1 bg-paper-300" />
    </div>
  );
}
