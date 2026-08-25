"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AdminField,
  AdminForm,
  adminInputClass,
  adminTextareaClass,
  SubmitButton,
} from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { BILLING_CYCLES, CYCLE_LABELS, MODULE_CATALOG, type PublicPlan } from "@/lib/plans";
import { createClientAction } from "../actions";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Provisioning form for a new client.
 *
 * One screen, one submit, one transaction. The alternative — a wizard that
 * creates the company, then the user, then the subscription — is how you end up
 * with orphaned companies when somebody closes the tab on step two.
 *
 * The seat override is folded away behind a checkbox rather than being an
 * ordinary field, because it is a commercial exception: it should take a
 * deliberate act, and it demands a reason before it will submit.
 */
export function NewClientForm({
  csrfToken,
  plans,
  provinces,
  currencies,
}: {
  csrfToken: string;
  plans: PublicPlan[];
  provinces: readonly { code: string; name: string }[];
  currencies: { code: string; label: string }[];
}) {
  const [planCode, setPlanCode] = useState(plans.find((plan) => plan.popular)?.code ?? plans[0]?.code ?? "");
  const [overrideSeats, setOverrideSeats] = useState(false);
  const [trialDays, setTrialDays] = useState(30);
  const [done, setDone] = useState<string | null>(null);
  const [modules, setModules] = useState(new Set(["ACCOUNTING"]));

  function toggleModule(id: string) {
    setModules((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selected = plans.find((plan) => plan.code === planCode);

  if (plans.length === 0) {
    return (
      <AdminCard>
        <p className="text-[0.8125rem] leading-6 text-ink-700">
          There are no published plans yet, so a client cannot be given a subscription.{" "}
          <Link href="/admin/plans" className="font-medium text-brand-700 hover:underline">
            Publish a plan first
          </Link>
          .
        </p>
      </AdminCard>
    );
  }

  return (
    <AdminForm
      action={createClientAction}
      csrfToken={csrfToken}
      className="space-y-5"
      onSuccess={(message) => setDone(message ?? "Client provisioned.")}
    >
      {done && (
        <div className="rounded-(--radius-card) border border-[color:var(--color-positive)]/30 bg-positive-soft px-5 py-4">
          <p className="text-[0.875rem] font-semibold text-positive">Client provisioned</p>
          <p className="mt-1.5 break-words text-[0.8125rem] leading-6 text-ink-800">{done}</p>
          <p className="mt-2 text-[0.75rem] leading-5 text-ink-700">
            If a temporary password is shown above, copy it now — it is stored only as a hash and cannot be
            retrieved. The user must change it at first sign-in.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/admin/clients"
              className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
            >
              Back to clients
            </Link>
          </div>
        </div>
      )}

      <AdminCard title="Company" subtitle="The legal and financial entity whose books these are">
        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField label="Operating name" required htmlFor="name">
            <input id="name" name="name" required className={adminInputClass} placeholder="Northbridge Consulting" />
          </AdminField>
          <AdminField label="Legal name" htmlFor="legalName" hint="Defaults to the operating name.">
            <input id="legalName" name="legalName" className={adminInputClass} placeholder="Northbridge Consulting Inc." />
          </AdminField>
          <AdminField label="Company email" htmlFor="email">
            <input id="email" name="email" type="email" className={adminInputClass} placeholder="accounts@company.ca" />
          </AdminField>
          <AdminField label="Phone" htmlFor="phone">
            <input id="phone" name="phone" className={adminInputClass} placeholder="+1 416 555 0134" />
          </AdminField>
          <AdminField label="Country" htmlFor="country">
            <select id="country" name="country" defaultValue="CA" className={adminInputClass}>
              <option value="CA">Canada</option>
              <option value="US">United States</option>
            </select>
          </AdminField>
          <AdminField
            label="Province"
            required
            htmlFor="province"
            hint="Decides which sales-tax codes are provisioned."
          >
            <select id="province" name="province" defaultValue="ON" required className={adminInputClass}>
              {provinces.map((province) => (
                <option key={province.code} value={province.code}>
                  {province.name}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Base currency" htmlFor="baseCurrency">
            <select id="baseCurrency" name="baseCurrency" defaultValue="CAD" className={adminInputClass}>
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.label}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField
            label="Fiscal year starts"
            htmlFor="fiscalYearStartMonth"
            hint="Becomes read-only once anything is posted, so it is worth getting right."
          >
            <select id="fiscalYearStartMonth" name="fiscalYearStartMonth" defaultValue="1" className={adminInputClass}>
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Industry" htmlFor="industry">
            <input id="industry" name="industry" className={adminInputClass} placeholder="Professional services" />
          </AdminField>
        </div>
      </AdminCard>

      <AdminCard
        title="Primary user"
        subtitle="The person who administers the company file. They get the PRIMARY role."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField label="Full name" required htmlFor="primaryUserName">
            <input id="primaryUserName" name="primaryUserName" required className={adminInputClass} placeholder="Dev Sharma" />
          </AdminField>
          <AdminField
            label="Email"
            required
            htmlFor="primaryUserEmail"
            hint="If this email already has an account, it is attached to the new company rather than duplicated."
          >
            <input
              id="primaryUserEmail"
              name="primaryUserEmail"
              type="email"
              required
              className={adminInputClass}
              placeholder="dev@company.ca"
            />
          </AdminField>
        </div>
        <p className="mt-3 rounded-md bg-paper-200 px-3 py-2 text-[0.75rem] leading-5 text-ink-700">
          A brand-new account gets a temporary password, shown once on this page, which must be changed at first
          sign-in. No password is ever emailed or stored in readable form.
        </p>
      </AdminCard>

      <AdminCard title="Subscription" subtitle="What they are being sold, and on what terms">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AdminField label="Plan" required htmlFor="planCode">
            <select
              id="planCode"
              name="planCode"
              required
              value={planCode}
              onChange={(event) => setPlanCode(event.target.value)}
              className={adminInputClass}
            >
              {plans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.name} — {plan.seats} seats
                </option>
              ))}
            </select>
          </AdminField>

          <AdminField label="Billing cycle" required htmlFor="billingCycle">
            <select id="billingCycle" name="billingCycle" defaultValue="MONTHLY" required className={adminInputClass}>
              {BILLING_CYCLES.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {CYCLE_LABELS[cycle]}
                </option>
              ))}
            </select>
          </AdminField>

          <AdminField
            label="Trial length (days)"
            htmlFor="trialDays"
            hint={trialDays === 0 ? "No trial — the subscription starts active." : "Sets the trial end date."}
          >
            <input
              id="trialDays"
              name="trialDays"
              type="number"
              min={0}
              max={365}
              value={trialDays}
              onChange={(event) => setTrialDays(Number(event.target.value))}
              className={adminInputClass}
            />
          </AdminField>
        </div>

        {selected && (
          <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
            {selected.name} includes {selected.seats} seats, {selected.companies}{" "}
            {selected.companies === 1 ? "company" : "companies"} and {selected.storageGb} GB of storage. The price is
            taken from the published plan at the moment this client is created and frozen onto their subscription.
          </p>
        )}

        <div className="mt-4 border-t border-paper-200 pt-4">
          <label className="flex items-start gap-2.5 text-[0.8125rem] text-ink-800">
            <input
              type="checkbox"
              checked={overrideSeats}
              onChange={(event) => setOverrideSeats(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-paper-400"
            />
            <span>
              Override the seat allowance
              <span className="block text-[0.75rem] text-muted-ink">
                A commercial exception. It is flagged on the subscription and recorded in the audit log.
              </span>
            </span>
          </label>

          {overrideSeats && (
            <div className="mt-3 grid gap-4 rounded-lg border border-[color:var(--color-caution)]/30 bg-caution-soft/50 p-3 sm:grid-cols-[8rem_1fr]">
              <AdminField label="Seats" required htmlFor="seatOverride">
                <input
                  id="seatOverride"
                  name="seatOverride"
                  type="number"
                  min={1}
                  required={overrideSeats}
                  defaultValue={selected?.seats ?? 5}
                  className={adminInputClass}
                />
              </AdminField>
              <AdminField label="Reason" required htmlFor="seatOverrideReason">
                <textarea
                  id="seatOverrideReason"
                  name="seatOverrideReason"
                  rows={2}
                  required={overrideSeats}
                  className={adminTextareaClass}
                  placeholder="e.g. Contract signed for 20 seats at the Professional rate."
                />
              </AdminField>
            </div>
          )}
        </div>
      </AdminCard>

      <AdminCard title="Modules" subtitle="What this client can use, independent of what their plan includes">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {MODULE_CATALOG.map((module) => (
            <label
              key={module.id}
              className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-paper-300 bg-white p-3 has-[:checked]:border-brand-300 has-[:checked]:bg-brand-soft"
            >
              <input
                type="checkbox"
                name="enabledModules"
                value={module.id}
                checked={module.id === "ACCOUNTING" || modules.has(module.id)}
                onChange={() => toggleModule(module.id)}
                disabled={module.id === "ACCOUNTING"}
                className="mt-0.5 h-4 w-4 rounded border-paper-400"
              />
              <span className="text-[0.8125rem] leading-5 text-ink-800">
                <span className="block font-medium text-ink-900">{module.name}</span>
                <span className="mt-0.5 block text-[0.75rem] text-muted-ink">{module.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </AdminCard>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Provisioning…">Create client</SubmitButton>
        <Link href="/admin/clients" className="text-[0.8125rem] font-medium text-ink-700 hover:underline">
          Cancel
        </Link>
        <span className="text-[0.75rem] text-muted-ink">
          Creates the company, its chart of accounts, tax codes, fiscal periods, the primary user and the
          subscription — all in one transaction.
        </span>
      </div>
    </AdminForm>
  );
}
