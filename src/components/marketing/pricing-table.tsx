"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Icon } from "@/components/shell/icons";
import { formatMoney } from "@/lib/money";
import {
  BILLING_CYCLES,
  CYCLE_LABELS,
  CYCLE_MONTHS,
  PLANS,
  cyclePriceCents,
  cycleSavingPercent,
  type BillingCycle,
  type Plan,
} from "@/lib/plans";

export function PricingTable({ initialCycle = "MONTHLY" }: { initialCycle?: BillingCycle }) {
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);

  return (
    <>
      <CycleToggle cycle={cycle} onChange={setCycle} />

      <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} cycle={cycle} />
        ))}
      </div>

      <ComparisonTable cycle={cycle} />
    </>
  );
}

function CycleToggle({ cycle, onChange }: { cycle: BillingCycle; onChange: (next: BillingCycle) => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Billing frequency"
        className="inline-flex rounded-xl border border-paper-300 bg-white p-1 shadow-[0_1px_2px_rgba(38,50,56,0.04)]"
      >
        {BILLING_CYCLES.map((option) => {
          const active = option === cycle;
          const saving = cycleSavingPercent(PLANS[0], option);
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option)}
              className={clsx(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-[0.875rem] font-medium transition-colors",
                active ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-paper-200",
              )}
            >
              {CYCLE_LABELS[option]}
              {saving > 0 && (
                <span
                  className={clsx(
                    "rounded-full px-1.5 py-px text-[0.6875rem] font-semibold",
                    active ? "bg-white/20 text-white" : "bg-positive-soft text-positive",
                  )}
                >
                  −{saving}%
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[0.8125rem] text-muted-ink">
        All prices in CAD, excluding tax. Change or cancel your plan at any time.
      </p>
    </div>
  );
}

function PlanCard({ plan, cycle }: { plan: Plan; cycle: BillingCycle }) {
  const perMonth = plan.monthlyEquivalentCents[cycle];
  const billed = cyclePriceCents(plan, cycle);
  const months = CYCLE_MONTHS[cycle];

  return (
    <div
      className={clsx(
        "relative flex flex-col rounded-(--radius-card) border bg-white p-6",
        plan.popular
          ? "border-brand-500 shadow-[0_2px_4px_rgba(47,109,156,0.12),0_16px_40px_-24px_rgba(47,109,156,0.4)]"
          : "border-paper-300 shadow-[0_1px_2px_rgba(38,50,56,0.04)]",
      )}
    >
      {plan.popular && (
        <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-white">
          Most popular
        </span>
      )}

      <h3 className="font-display text-[1.125rem] font-semibold text-ink-950">{plan.name}</h3>
      <p className="mt-2 min-h-[3rem] text-[0.8125rem] leading-6 text-muted-ink">{plan.forWhom}</p>

      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="tnum font-display text-[2rem] font-semibold leading-none tracking-[-0.02em] text-ink-950">
          {formatMoney(perMonth, { showCurrency: true }).replace(/\.00$/, "")}
        </span>
        <span className="text-[0.8125rem] text-muted-ink">/ month</span>
      </p>
      <p className="tnum mt-1.5 text-[0.75rem] text-muted-ink">
        {months === 1
          ? "billed monthly"
          : `${formatMoney(billed).replace(/\.00$/, "")} billed every ${months} months`}
      </p>

      <dl className="mt-5 grid gap-1.5 border-y border-paper-300 py-4 text-[0.8125rem]">
        <Line label="Users" value={`${plan.seats} included`} />
        <Line label="Companies" value={plan.companies === 1 ? "1 company" : `up to ${plan.companies}`} />
        <Line label="Storage" value={`${plan.storageGb} GB`} />
        <Line label="Support" value={plan.support} />
      </dl>

      <ul className="mt-5 grid flex-1 gap-2.5">
        {plan.includes.map((line) => (
          <li key={line} className="flex gap-2">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
            <span className="text-[0.8125rem] leading-6 text-ink-700">{line}</span>
          </li>
        ))}
      </ul>

      <Link
        href={`/signup?plan=${plan.id}&cycle=${cycle}`}
        className={clsx(
          "mt-6 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[0.875rem] font-medium transition-colors",
          plan.popular
            ? "bg-brand-600 text-white hover:bg-brand-700"
            : "border border-paper-400 bg-white text-ink-800 hover:border-ink-300 hover:bg-paper-100",
        )}
      >
        {plan.contactOnly ? "Talk to sales" : "Subscribe"}
      </Link>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

/** `true`/`false` render as a tick or a dash; a string renders verbatim. */
const COMPARISON_ROWS: { label: string; value: (plan: Plan) => string | boolean }[] = [
  { label: "Users included", value: (p) => String(p.seats) },
  { label: "Companies / entities", value: (p) => String(p.companies) },
  { label: "Document storage", value: (p) => `${p.storageGb} GB` },
  { label: "Double-entry ledger", value: () => true },
  { label: "GST/HST, PST, QST engine", value: () => true },
  { label: "Bank import & reconciliation", value: () => true },
  { label: "Financial statement pack", value: () => true },
  { label: "Bill approvals & period close", value: (p) => p.id !== "STARTER" },
  { label: "Budgets & budget vs actual", value: (p) => p.id !== "STARTER" },
  { label: "Multi-company switching", value: (p) => p.companies > 1 },
  { label: "Firm workspace & review queue", value: (p) => p.id === "FIRM" },
  { label: "Audit trail", value: () => true },
  { label: "Support", value: (p) => p.support },
];

function ComparisonTable({ cycle }: { cycle: BillingCycle }) {
  return (
    <div className="mt-16 overflow-x-auto rounded-(--radius-card) border border-paper-300 bg-white">
      <table className="w-full min-w-[46rem] border-collapse text-[0.8125rem]">
        <caption className="sr-only">Feature comparison across Red Leaf plans</caption>
        <thead>
          <tr className="border-b border-paper-300 bg-paper-100">
            <th scope="col" className="px-4 py-3 text-left font-semibold text-ink-900">
              Compare plans
            </th>
            {PLANS.map((plan) => (
              <th key={plan.id} scope="col" className="px-4 py-3 text-center font-semibold text-ink-900">
                {plan.name}
                <span className="tnum mt-0.5 block text-[0.75rem] font-normal text-muted-ink">
                  {formatMoney(plan.monthlyEquivalentCents[cycle]).replace(/\.00$/, "")}/mo
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.label} className="border-b border-paper-200 last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink-700">
                {row.label}
              </th>
              {PLANS.map((plan) => {
                const value = row.value(plan);
                return (
                  <td key={plan.id} className="px-4 py-2.5 text-center text-ink-900">
                    {value === true ? (
                      <>
                        <Icon name="check" className="mx-auto h-4 w-4 text-positive" />
                        <span className="sr-only">Included</span>
                      </>
                    ) : value === false ? (
                      <>
                        <span aria-hidden className="text-ink-300">
                          &mdash;
                        </span>
                        <span className="sr-only">Not included</span>
                      </>
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
