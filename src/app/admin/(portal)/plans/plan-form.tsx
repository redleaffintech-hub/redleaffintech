"use client";

import { useState } from "react";
import Link from "next/link";
import { AdminField, AdminForm, adminInputClass, adminTextareaClass, SubmitButton } from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { formatMoney } from "@/lib/money";
import {
  BILLING_CYCLES,
  CYCLE_BILLED_AS,
  CYCLE_LABELS,
  CYCLE_MONTHS,
  MODULE_CATALOG,
  type BillingCycle,
} from "@/lib/plans";
import { createPlanAction, updatePlanAction } from "./actions";

export interface PlanFormValues {
  id?: string;
  code: string;
  name: string;
  description: string;
  forWhom: string;
  currency: string;
  seats: number;
  companies: number;
  storageGb: number;
  support: string;
  modules: string[];
  features: string[];
  isPopular: boolean;
  contactOnly: boolean;
  isPublic: boolean;
  sortOrder: number;
  prices: Record<BillingCycle, { cycleAmountCents: number; monthlyEquivalentCents: number }>;
}

const EMPTY: PlanFormValues = {
  code: "",
  name: "",
  description: "",
  forWhom: "",
  currency: "CAD",
  seats: 5,
  companies: 1,
  storageGb: 25,
  support: "Email support",
  modules: ["ACCOUNTING"],
  features: [],
  isPopular: false,
  contactOnly: false,
  isPublic: true,
  sortOrder: 50,
  prices: {
    MONTHLY: { cycleAmountCents: 0, monthlyEquivalentCents: 0 },
    QUARTERLY: { cycleAmountCents: 0, monthlyEquivalentCents: 0 },
    ANNUAL: { cycleAmountCents: 0, monthlyEquivalentCents: 0 },
  },
};

const dollars = (cents: number) => (cents === 0 ? "" : (cents / 100).toFixed(2));

/**
 * The plan editor.
 *
 * Two figures per cycle rather than one, because they are genuinely different
 * things: the *billed amount* is what the customer is charged for a quarter or a
 * year, and the *monthly equivalent* is the comparison figure the pricing page
 * leads with. Deriving one from the other would be convenient and wrong — the
 * discount on an annual plan is a commercial decision, not arithmetic.
 *
 * The live preview beside the form renders from exactly the values being typed,
 * through the same shape the public page consumes, so what an operator sees here
 * is what a visitor will see after publishing.
 */
export function PlanForm({
  csrfToken,
  initial,
  isReferenced,
}: {
  csrfToken: string;
  initial?: PlanFormValues;
  /** True when a subscription points at this plan — its code is then frozen. */
  isReferenced?: boolean;
}) {
  const values = initial ?? EMPTY;
  const editing = Boolean(values.id);

  const [name, setName] = useState(values.name);
  const [forWhom, setForWhom] = useState(values.forWhom);
  const [seats, setSeats] = useState(values.seats);
  const [companies, setCompanies] = useState(values.companies);
  const [storageGb, setStorageGb] = useState(values.storageGb);
  const [support, setSupport] = useState(values.support);
  const [features, setFeatures] = useState(values.features.join("\n"));
  const [currency, setCurrency] = useState(values.currency);
  const [contactOnly, setContactOnly] = useState(values.contactOnly);
  const [popular, setPopular] = useState(values.isPopular);
  const [prices, setPrices] = useState(values.prices);
  const [previewCycle, setPreviewCycle] = useState<BillingCycle>("MONTHLY");

  function setPrice(cycle: BillingCycle, field: "cycleAmountCents" | "monthlyEquivalentCents", value: string) {
    const parsed = Math.round(Number(value.replace(/[^0-9.]/g, "")) * 100);
    setPrices((current) => ({
      ...current,
      [cycle]: { ...current[cycle], [field]: Number.isFinite(parsed) ? parsed : 0 },
    }));
  }

  /** Fill the billed amount from the monthly rate — a starting point, not a rule. */
  function deriveCycleAmount(cycle: BillingCycle) {
    setPrices((current) => ({
      ...current,
      [cycle]: {
        ...current[cycle],
        cycleAmountCents: current[cycle].monthlyEquivalentCents * CYCLE_MONTHS[cycle],
      },
    }));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <AdminForm action={editing ? updatePlanAction : createPlanAction} csrfToken={csrfToken} className="space-y-5">
        {values.id && <input type="hidden" name="planId" value={values.id} />}

        <AdminCard title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <AdminField
              label="Plan code"
              required
              htmlFor="code"
              hint={
                isReferenced
                  ? "Frozen: subscriptions reference this code. Create a new plan instead of renaming it."
                  : "Capitals, digits and underscores. Never reused, never renamed once sold."
              }
            >
              <input
                id="code"
                name="code"
                required
                readOnly={isReferenced}
                defaultValue={values.code}
                pattern="[A-Z][A-Z0-9_]{1,31}"
                className={`${adminInputClass} font-mono ${isReferenced ? "bg-paper-200" : ""}`}
                placeholder="PROFESSIONAL"
              />
            </AdminField>

            <AdminField label="Public name" required htmlFor="name">
              <input
                id="name"
                name="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={adminInputClass}
                placeholder="Professional"
              />
            </AdminField>

            <AdminField label="Who this is for" htmlFor="forWhom" hint="One line, shown on the pricing card.">
              <input
                id="forWhom"
                name="forWhom"
                value={forWhom}
                onChange={(event) => setForWhom(event.target.value)}
                className={adminInputClass}
                placeholder="A growing incorporated business with a bookkeeper."
              />
            </AdminField>

            <AdminField label="Description" htmlFor="description" hint="Used in listings and search results.">
              <input
                id="description"
                name="description"
                defaultValue={values.description}
                className={adminInputClass}
              />
            </AdminField>
          </div>
        </AdminCard>

        <AdminCard title="Pricing" subtitle="Integer minor units. Both figures are stored; neither is derived.">
          <div className="mb-4 grid gap-4 sm:grid-cols-[10rem_1fr]">
            <AdminField label="Currency" required htmlFor="currency">
              <input
                id="currency"
                name="currency"
                required
                maxLength={3}
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                className={`${adminInputClass} font-mono uppercase`}
              />
            </AdminField>
            <div className="flex items-end">
              <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-800">
                <input
                  type="checkbox"
                  name="contactOnly"
                  checked={contactOnly}
                  onChange={(event) => setContactOnly(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-paper-400"
                />
                <span>
                  Contact sales only
                  <span className="block text-[0.75rem] text-muted-ink">
                    The card shows &ldquo;Let&rsquo;s talk&rdquo; instead of a price, and a zero price is allowed.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="space-y-3">
            {BILLING_CYCLES.map((cycle) => (
              <div
                key={cycle}
                className="grid gap-3 rounded-lg border border-paper-300 p-3 sm:grid-cols-[7rem_1fr_1fr_auto] sm:items-end"
              >
                <p className="text-[0.8125rem] font-medium text-ink-900">{CYCLE_LABELS[cycle]}</p>

                <AdminField label="Per month (display)" htmlFor={`monthly-${cycle}`}>
                  <input
                    id={`monthly-${cycle}`}
                    name={`price_${cycle}_monthly`}
                    inputMode="decimal"
                    value={dollars(prices[cycle].monthlyEquivalentCents)}
                    onChange={(event) => setPrice(cycle, "monthlyEquivalentCents", event.target.value)}
                    className={adminInputClass}
                    placeholder="49.00"
                  />
                </AdminField>

                <AdminField label={`Billed every ${CYCLE_MONTHS[cycle]} month(s)`} htmlFor={`cycle-${cycle}`}>
                  <input
                    id={`cycle-${cycle}`}
                    name={`price_${cycle}_cycle`}
                    inputMode="decimal"
                    value={dollars(prices[cycle].cycleAmountCents)}
                    onChange={(event) => setPrice(cycle, "cycleAmountCents", event.target.value)}
                    className={adminInputClass}
                    placeholder="147.00"
                  />
                </AdminField>

                <button
                  type="button"
                  onClick={() => deriveCycleAmount(cycle)}
                  className="mb-px inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-2.5 text-[0.75rem] font-medium text-ink-700 hover:bg-paper-100"
                  title={`Set the billed amount to the monthly rate × ${CYCLE_MONTHS[cycle]}`}
                >
                  × {CYCLE_MONTHS[cycle]}
                </button>
              </div>
            ))}
          </div>
        </AdminCard>

        <AdminCard title="Allowances and entitlements">
          <div className="grid gap-4 sm:grid-cols-3">
            <AdminField label="Seats" required htmlFor="seats">
              <input
                id="seats"
                name="seats"
                type="number"
                min={1}
                required
                value={seats}
                onChange={(event) => setSeats(Number(event.target.value))}
                className={adminInputClass}
              />
            </AdminField>
            <AdminField label="Companies" required htmlFor="companies">
              <input
                id="companies"
                name="companies"
                type="number"
                min={1}
                required
                value={companies}
                onChange={(event) => setCompanies(Number(event.target.value))}
                className={adminInputClass}
              />
            </AdminField>
            <AdminField label="Storage (GB)" required htmlFor="storageGb">
              <input
                id="storageGb"
                name="storageGb"
                type="number"
                min={1}
                required
                value={storageGb}
                onChange={(event) => setStorageGb(Number(event.target.value))}
                className={adminInputClass}
              />
            </AdminField>
          </div>

          <div className="mt-4">
            <AdminField label="Support level" required htmlFor="support">
              <input
                id="support"
                name="support"
                required
                value={support}
                onChange={(event) => setSupport(event.target.value)}
                className={adminInputClass}
              />
            </AdminField>
          </div>

          <fieldset className="mt-4">
            <legend className="mb-2 text-[0.75rem] font-medium text-ink-800">Included modules</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODULE_CATALOG.map((module) => (
                <label key={module.id} className="flex items-start gap-2.5 text-[0.8125rem] text-ink-800">
                  <input
                    type="checkbox"
                    name="modules"
                    value={module.id}
                    defaultChecked={values.modules.includes(module.id)}
                    className="mt-0.5 h-4 w-4 rounded border-paper-400"
                  />
                  <span>
                    {module.name}
                    {!module.available && <span className="block text-[0.75rem] text-muted-ink">not shipped yet</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4">
            <AdminField
              label="Feature list"
              htmlFor="features"
              hint="One bullet per line, in the order they should appear. Up to 20."
            >
              <textarea
                id="features"
                name="features"
                rows={6}
                value={features}
                onChange={(event) => setFeatures(event.target.value)}
                className={adminTextareaClass}
              />
            </AdminField>
          </div>
        </AdminCard>

        <AdminCard title="Presentation">
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <AdminField label="Display order" required htmlFor="sortOrder" hint="Lower comes first.">
              <input
                id="sortOrder"
                name="sortOrder"
                type="number"
                min={0}
                required
                defaultValue={values.sortOrder}
                className={adminInputClass}
              />
            </AdminField>

            <div className="space-y-2.5">
              <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-800">
                <input
                  type="checkbox"
                  name="isPopular"
                  checked={popular}
                  onChange={(event) => setPopular(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-paper-400"
                />
                <span>
                  Most popular
                  <span className="block text-[0.75rem] text-muted-ink">Highlights this card on the pricing page.</span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-800">
                <input
                  type="checkbox"
                  name="isPublic"
                  defaultChecked={values.isPublic}
                  className="mt-0.5 h-4 w-4 rounded border-paper-400"
                />
                <span>
                  Show on the public pricing page
                  <span className="block text-[0.75rem] text-muted-ink">
                    Takes effect immediately — visibility is a publication control, not a draft edit. A private plan
                    can still be assigned by an administrator.
                  </span>
                </span>
              </label>
            </div>
          </div>
        </AdminCard>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving…">{editing ? "Save draft changes" : "Create plan"}</SubmitButton>
          <Link href="/admin/plans" className="text-[0.8125rem] font-medium text-ink-700 hover:underline">
            Cancel
          </Link>
          <span className="text-[0.75rem] leading-5 text-muted-ink">
            Saving does not change what visitors see. Publish from the plan&rsquo;s page when the figures are right.
          </span>
        </div>
      </AdminForm>

      <div className="lg:sticky lg:top-28">
        <AdminCard
          title="Preview"
          subtitle="How the card will look once published"
          actions={
            <div className="flex gap-1">
              {BILLING_CYCLES.map((cycle) => (
                <button
                  key={cycle}
                  type="button"
                  onClick={() => setPreviewCycle(cycle)}
                  className={
                    cycle === previewCycle
                      ? "rounded-md bg-ink-950 px-2 py-1 text-[0.6875rem] font-medium text-white"
                      : "rounded-md border border-paper-400 px-2 py-1 text-[0.6875rem] font-medium text-ink-700 hover:bg-paper-100"
                  }
                >
                  {CYCLE_LABELS[cycle]}
                </button>
              ))}
            </div>
          }
        >
          <div
            className={
              popular
                ? "rounded-(--radius-card) border-2 border-brand-500 bg-white p-4"
                : "rounded-(--radius-card) border border-paper-300 bg-white p-4"
            }
          >
            {popular && (
              <span className="mb-2 inline-block rounded-full bg-brand-600 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-white">
                Most popular
              </span>
            )}
            <h3 className="font-display text-[1rem] font-semibold text-ink-950">{name || "Plan name"}</h3>
            <p className="mt-1 min-h-[2.5rem] text-[0.75rem] leading-5 text-muted-ink">
              {forWhom || "Who this plan is for."}
            </p>

            {contactOnly && prices[previewCycle].cycleAmountCents === 0 ? (
              <p className="mt-3 font-display text-[1.25rem] font-semibold text-ink-950">Let&rsquo;s talk</p>
            ) : (
              <>
                <p className="mt-3 flex items-baseline gap-1.5">
                  <span className="tnum font-display text-[1.75rem] font-semibold leading-none text-ink-950">
                    {formatMoney(prices[previewCycle].monthlyEquivalentCents, {
                      showCurrency: true,
                      currency: currency || "CAD",
                    }).replace(/\.00$/, "")}
                  </span>
                  <span className="text-[0.75rem] text-muted-ink">/ month</span>
                </p>
                <p className="tnum mt-1 text-[0.6875rem] text-muted-ink">
                  {formatMoney(prices[previewCycle].cycleAmountCents, { currency: currency || "CAD" }).replace(
                    /\.00$/,
                    "",
                  )}{" "}
                  {CYCLE_BILLED_AS[previewCycle]}
                </p>
              </>
            )}

            <dl className="mt-4 grid gap-1 border-y border-paper-300 py-3 text-[0.75rem]">
              <PreviewLine label="Users" value={`${seats} included`} />
              <PreviewLine label="Companies" value={companies === 1 ? "1 company" : `up to ${companies}`} />
              <PreviewLine label="Storage" value={`${storageGb} GB`} />
              <PreviewLine label="Support" value={support} />
            </dl>

            <ul className="mt-3 space-y-1.5">
              {features
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, index) => (
                  <li key={`${line}-${index}`} className="text-[0.75rem] leading-5 text-ink-700">
                    · {line}
                  </li>
                ))}
            </ul>
          </div>

          <p className="mt-3 text-[0.6875rem] leading-5 text-muted-ink">
            Rendered from what you have typed, through the same plan shape the public page consumes.
          </p>
        </AdminCard>
      </div>
    </div>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
