import type { ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatDateLong } from "@/lib/dates";
import { Money } from "@/components/ui";

/**
 * Common chrome for every financial statement: the company/period masthead
 * that a printed report needs, and the reconciliation banner that tells the
 * reader whether the statement ties to the ledger (§12 traceability rule).
 */
export function ReportSheet({
  companyName,
  title,
  periodLabel,
  basisNote = "Prepared on an accrual basis from posted journal entries.",
  children,
  toolbar,
}: {
  companyName: string;
  title: string;
  periodLabel: string;
  basisNote?: string;
  children: ReactNode;
  toolbar?: ReactNode;
}) {
  return (
    <>
      {toolbar && <div className="no-print mb-4 flex flex-wrap items-center gap-2">{toolbar}</div>}
      <section className="print-full rounded-[--radius-card] border border-paper-300 bg-white p-6 shadow-[0_1px_2px_rgba(10,16,32,0.04),0_8px_24px_-16px_rgba(10,16,32,0.16)] lg:p-8">
        <header className="mb-6 border-b border-paper-300 pb-5 text-center">
          <p className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-950">{companyName}</p>
          <h2 className="mt-0.5 text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">{title}</h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted-ink">{periodLabel}</p>
          <p className="mt-1 text-[0.6875rem] text-muted-ink">{basisNote}</p>
        </header>
        {children}
      </section>
    </>
  );
}

export function ReconciliationBanner({
  reconciled,
  message,
  detail,
}: {
  reconciled: boolean;
  message: string;
  detail?: string;
}) {
  return (
    <div
      className={clsx(
        "mb-5 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[0.8125rem]",
        reconciled
          ? "border-[color:var(--color-positive)]/25 bg-positive-soft text-positive"
          : "border-[color:var(--color-negative)]/25 bg-negative-soft text-negative",
      )}
    >
      <span className={clsx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", reconciled ? "bg-positive" : "bg-negative")} />
      <span>
        <span className="font-medium">{message}</span>
        {detail && <span className="mt-0.5 block opacity-90">{detail}</span>}
      </span>
    </div>
  );
}

/** A statement line. `href` makes the figure drill down to its transactions. */
export function StatementRow({
  label,
  code,
  value,
  comparison,
  href,
  indent = 0,
  emphasis,
  total,
}: {
  label: string;
  code?: string;
  value: number;
  comparison?: number;
  href?: string;
  indent?: number;
  emphasis?: boolean;
  total?: boolean;
}) {
  const labelNode = (
    <span className="inline-flex items-baseline gap-2">
      {code && <span className="tnum text-[0.75rem] text-muted-ink">{code}</span>}
      <span>{label}</span>
    </span>
  );

  return (
    <tr
      className={clsx(
        "group",
        total && "border-t border-paper-400",
        emphasis && "border-t-2 border-ink-900",
        !total && !emphasis && "hover:bg-paper-100",
      )}
    >
      <td
        className={clsx(
          "py-1.5 pr-4 text-[0.8125rem]",
          (total || emphasis) && "font-semibold text-ink-950",
          !total && !emphasis && "text-ink-800",
        )}
        style={{ paddingLeft: `${indent * 1.25}rem` }}
      >
        {href ? (
          <Link href={href} className="hover:text-brand-700 hover:underline">
            {labelNode}
          </Link>
        ) : (
          labelNode
        )}
      </td>
      <td className={clsx("py-1.5 pl-4 text-right", (total || emphasis) && "font-semibold")}>
        <Money cents={value} bold={total || emphasis} />
      </td>
      {comparison !== undefined && (
        <td className="py-1.5 pl-4 text-right text-muted-ink">
          <Money cents={comparison} />
        </td>
      )}
    </tr>
  );
}

export function StatementSectionHeader({ label, colSpan = 3 }: { label: string; colSpan?: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-ink">
        {label}
      </td>
    </tr>
  );
}

export function periodLabel(from: Date, to: Date): string {
  return `For the period ${formatDateLong(from)} to ${formatDateLong(to)}`;
}

export function asOfLabel(date: Date): string {
  return `As at ${formatDateLong(date)}`;
}
