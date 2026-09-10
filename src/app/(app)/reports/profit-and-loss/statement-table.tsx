"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { formatMoney } from "@/lib/money";
import type { IncomeStatement, StatementSection, StatementSubtotal } from "@/server/reports/financials-fs";

/**
 * The income statement as a period-comparison grid.
 *
 * Presentation rules:
 *  - amounts right-aligned with tabular numerals, negatives in parentheses;
 *  - calculated subtotals bold above a rule, detail rows lighter;
 *  - EBITDA and net income outlined (amber and green) as the two figures a
 *    reader looks for first.
 *
 * The outlines are never the only signal. Every subtotal is also bold, ruled
 * off and marked up as a row header, so the statement reads correctly in
 * monochrome print and to a screen reader — the colour is decoration, not
 * information.
 *
 * A category holding more than one account can be expanded to its general
 * ledger accounts. Collapsed is the default, which is what keeps the summary
 * as clean as the printed statement it is modelled on.
 */

function Amount({ cents, currency, bold }: { cents: number; currency: string; bold?: boolean }) {
  return (
    <span className={clsx("tnum", bold ? "font-semibold text-ink-950" : "text-ink-800")}>
      {formatMoney(cents, { showCurrency: false, accountingNegative: true, currency })}
    </span>
  );
}

function SubtotalRow({
  subtotal,
  currency,
  emphasis,
}: {
  subtotal: StatementSubtotal;
  currency: string;
  emphasis?: "ebitda" | "net";
}) {
  return (
    <tr
      className={clsx(
        "border-t border-paper-400",
        emphasis === "ebitda" && "bg-caution-soft/60",
        emphasis === "net" && "bg-positive-soft/60",
      )}
    >
      <th
        scope="row"
        className={clsx(
          "py-2 pr-4 text-left text-[0.8125rem] font-semibold text-ink-950",
          emphasis === "ebitda" && "border-l-[3px] border-l-[color:var(--color-caution)] pl-2",
          emphasis === "net" && "border-l-[3px] border-l-[color:var(--color-positive)] pl-2",
          !emphasis && "pl-3",
        )}
      >
        {subtotal.label}
      </th>
      {subtotal.amounts.map((cents, i) => (
        <td key={i} className="py-2 pl-4 pr-3 text-right">
          <Amount cents={cents} currency={currency} bold />
        </td>
      ))}
    </tr>
  );
}

function Category({
  section,
  currency,
  glLink,
}: {
  section: StatementSection;
  currency: string;
  glLink: (accountId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  if (section.rows.length === 0) return null;

  // One account needs no expansion — the category label simply drills through.
  if (section.rows.length === 1) {
    const only = section.rows[0];
    return (
      <tr className="hover:bg-paper-100">
        <th scope="row" className="py-1.5 pl-3 pr-4 text-left text-[0.8125rem] font-normal text-ink-800">
          <Link href={glLink(only.accountId)} className="hover:text-brand-700 hover:underline">
            {section.label}
          </Link>
        </th>
        {section.totals.map((cents, i) => (
          <td key={i} className="py-1.5 pl-4 pr-3 text-right">
            <Amount cents={cents} currency={currency} />
          </td>
        ))}
      </tr>
    );
  }

  return (
    <>
      <tr className="hover:bg-paper-100">
        <th scope="row" className="py-1.5 pl-3 pr-4 text-left text-[0.8125rem] font-normal text-ink-800">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 text-left hover:text-brand-700"
          >
            <span className={clsx("text-[0.5625rem] text-ink-400 transition-transform", open && "rotate-90")}>▶</span>
            {section.label}
            <span className="text-[0.6875rem] text-muted-ink">({section.rows.length})</span>
          </button>
        </th>
        {section.totals.map((cents, i) => (
          <td key={i} className="py-1.5 pl-4 pr-3 text-right">
            <Amount cents={cents} currency={currency} />
          </td>
        ))}
      </tr>

      {/* Printed output shows the detail regardless: a statement filed on paper
          should not depend on what someone happened to have expanded. */}
      {section.rows.map((row) => (
        <tr key={row.accountId} className={clsx("hover:bg-paper-100", !open && "hidden print:table-row")}>
          <td className="py-1 pl-8 pr-4 text-[0.75rem]">
            <Link href={glLink(row.accountId)} className="text-muted-ink hover:text-brand-700 hover:underline">
              <span className="tnum mr-2 text-ink-400">{row.code}</span>
              {row.name}
            </Link>
          </td>
          {row.amounts.map((cents, i) => (
            <td key={i} className="py-1 pl-4 pr-3 text-right text-[0.75rem]">
              <span className="tnum text-muted-ink">
                {formatMoney(cents, { showCurrency: false, accountingNegative: true, currency })}
              </span>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function IncomeStatementTable({
  statement,
  ledgerFrom,
  ledgerTo,
}: {
  statement: IncomeStatement;
  /** Period the drill-down opens the general ledger for, as ISO dates. */
  ledgerFrom: string;
  ledgerTo: string;
}) {
  const { periods, currency, sections, subtotals } = statement;
  // Built here rather than passed in: a function cannot cross the server /
  // client boundary as a prop.
  const glLink = (accountId: string) =>
    `/accounting/general-ledger?account=${accountId}&from=${ledgerFrom}&to=${ledgerTo}`;
  const find = (key: string) => sections.find((s) => s.key === key)!;
  const category = (key: string) => (
    <Category section={find(key)} currency={currency} glLink={glLink} />
  );

  return (
    // Horizontal scroll on small screens. The printed sheet is wide enough for
    // four columns, so it never scrolls there.
    <div className="thin-scroll -mx-6 overflow-x-auto px-6 print:mx-0 print:overflow-visible print:px-0">
      <table className="w-full min-w-[34rem] border-collapse">
        <caption className="sr-only">
          Income statement by period. Amounts in {currency}; negative amounts are shown in parentheses.
        </caption>
        <thead>
          <tr className="bg-brand-700 text-white">
            <th scope="col" className="rounded-l-md py-2 pl-3 pr-4 text-left text-[0.8125rem] font-semibold">
              Income statement
            </th>
            {periods.map((period, i) => (
              <th
                key={period.label}
                scope="col"
                className={clsx(
                  "py-2 pl-4 pr-3 text-right text-[0.8125rem] font-semibold whitespace-nowrap",
                  i === periods.length - 1 && "rounded-r-md",
                )}
              >
                {period.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="h-2" />

          {category("NET_SALES")}
          {category("MATERIAL_EXPENSE")}
          <SubtotalRow subtotal={subtotals.GROSS_PROFIT} currency={currency} />

          {category("SGA")}
          <SubtotalRow subtotal={subtotals.EBITDA} currency={currency} emphasis="ebitda" />

          {category("DEPRECIATION_AMORTIZATION")}
          <SubtotalRow subtotal={subtotals.EBIT} currency={currency} />

          {category("INTEREST_EXPENSE")}
          {category("INTEREST_INCOME")}
          {category("OTHER_INCOME")}
          {category("OTHER_EXPENSE")}
          <SubtotalRow subtotal={subtotals.EBT} currency={currency} />

          {category("TAXES")}
          <SubtotalRow subtotal={subtotals.NET_INCOME} currency={currency} emphasis="net" />
        </tbody>
      </table>
    </div>
  );
}
