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
  addonCycleCents,
  cyclePriceCents,
  cycleSavingPercent,
  monthlyEquivalentCents,
  type BillingCycle,
  type PublicAddon,
  type PublicPlan,
} from "@/lib/plans";

const money = (cents: number, currency: string) => formatMoney(cents, { currency }).replace(/\.00$/, "");

/**
 * The plan and add-ons arrive as props rather than being imported: they are
 * read from the catalogue by the server component that renders this, so what a
 * visitor sees is whatever an administrator last published — never a figure
 * compiled into the bundle.
 */
export function PricingTable({
  plans,
  addons = [],
  initialCycle = "MONTHLY",
}: {
  plans: PublicPlan[];
  addons?: PublicAddon[];
  initialCycle?: BillingCycle;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);
  const [selected, setSelected] = useState<string[]>([]);

  if (plans.length === 0) {
    return (
      <p className="mx-auto max-w-lg rounded-(--radius-card) border border-paper-300 bg-white p-6 text-center text-[0.875rem] text-muted-ink">
        Our plans are being updated. Please{" "}
        <Link href="/contact" className="font-medium text-brand-700 hover:underline">
          get in touch
        </Link>{" "}
        and we will quote you directly.
      </p>
    );
  }

  const plan = plans[0];
  const chosen = addons.filter((addon) => selected.includes(addon.code));
  const totalCents = cyclePriceCents(plan, cycle) + chosen.reduce((sum, addon) => sum + addonCycleCents(addon, cycle), 0);
  const months = CYCLE_MONTHS[cycle];
  const signupHref = `/signup?plan=${plan.code}&cycle=${cycle}${chosen.length ? `&addons=${chosen.map((a) => a.code).join(",")}` : ""}`;

  return (
    <>
      <CycleToggle plan={plan} cycle={cycle} onChange={setCycle} />

      <div className="mx-auto mt-10 grid max-w-5xl gap-5 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div className="relative flex flex-col rounded-(--radius-card) border border-brand-500 bg-white p-6 shadow-[0_2px_4px_rgba(47,109,156,0.12),0_16px_40px_-24px_rgba(47,109,156,0.4)]">
          <h3 className="font-display text-[1.125rem] font-semibold text-ink-950">{plan.name}</h3>
          <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">{plan.forWhom}</p>

          <p className="mt-4 flex items-baseline gap-1.5">
            <span className="tnum font-display text-[2rem] font-semibold leading-none tracking-[-0.02em] text-ink-950">
              {money(cyclePriceCents(plan, cycle), plan.currency)}
            </span>
            <span className="text-[0.8125rem] text-muted-ink">/ {months === 1 ? "month" : "year"}</span>
          </p>
          {months > 1 && (
            <p className="tnum mt-1.5 text-[0.75rem] text-muted-ink">
              about {money(monthlyEquivalentCents(plan, cycle), plan.currency)} / month, billed annually
            </p>
          )}

          <dl className="mt-5 grid gap-1.5 border-y border-paper-300 py-4 text-[0.8125rem]">
            <Line label="Users" value={`${plan.seats} included`} />
            <Line label="Companies" value={plan.companies === 1 ? "1 company" : `up to ${plan.companies}`} />
            <Line label="Storage" value={`${plan.storageGb} GB`} />
            <Line label="Support" value={plan.support} />
          </dl>

          <ul className="mt-5 grid gap-2.5">
            {plan.includes.map((line) => (
              <li key={line} className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                <span className="text-[0.8125rem] leading-6 text-ink-700">{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-(--radius-card) border border-paper-300 bg-white p-6">
          <h3 className="font-display text-[1.125rem] font-semibold text-ink-950">Add-ons</h3>
          <p className="mt-1 text-[0.8125rem] text-muted-ink">Add only what you need, and change it any time.</p>

          <ul className="mt-4 grid gap-3">
            {addons.map((addon) => {
              const on = selected.includes(addon.code);
              return (
                <li key={addon.code}>
                  <label
                    className={clsx(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
                      on ? "border-brand-500 bg-brand-soft" : "border-paper-300 hover:bg-paper-100",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelected((current) => (on ? current.filter((c) => c !== addon.code) : [...current, addon.code]))
                      }
                      className="mt-1 h-4 w-4 accent-[var(--color-brand-600)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-semibold text-ink-900">{addon.name}</span>
                      <span className="mt-0.5 block text-[0.8125rem] leading-5 text-muted-ink">{addon.description}</span>
                    </span>
                    <span className="tnum shrink-0 text-right text-[0.875rem] font-semibold text-ink-900">
                      +{money(addonCycleCents(addon, cycle), addon.currency)}
                      <span className="block text-[0.6875rem] font-normal text-muted-ink">/ {months === 1 ? "month" : "year"}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex items-baseline justify-between border-t border-paper-300 pt-4">
            <span className="text-[0.875rem] text-ink-700">
              Your total{chosen.length > 0 ? ` (${plan.name} + ${chosen.map((a) => a.name).join(" + ")})` : ""}
            </span>
            <span className="tnum font-display text-[1.5rem] font-semibold text-ink-950">
              {money(totalCents, plan.currency)}
              <span className="ml-1 text-[0.8125rem] font-normal text-muted-ink">/ {months === 1 ? "month" : "year"}</span>
            </span>
          </div>

          <Link
            href={signupHref}
            className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-[0.875rem] font-medium text-white transition-colors hover:bg-brand-700"
          >
            Subscribe
          </Link>
        </div>
      </div>
    </>
  );
}

function CycleToggle({ plan, cycle, onChange }: { plan: PublicPlan; cycle: BillingCycle; onChange: (next: BillingCycle) => void }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Billing frequency"
        className="inline-flex rounded-xl border border-paper-300 bg-white p-1 shadow-[0_1px_2px_rgba(38,50,56,0.04)]"
      >
        {BILLING_CYCLES.map((option) => {
          const active = option === cycle;
          const saving = cycleSavingPercent(plan, option);
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

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
