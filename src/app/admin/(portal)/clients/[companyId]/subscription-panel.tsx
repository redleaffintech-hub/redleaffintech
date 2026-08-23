"use client";

import { useState } from "react";
import { AdminField, AdminForm, adminInputClass, adminTextareaClass, SubmitButton } from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { BILLING_CYCLES, CYCLE_LABELS, type PublicPlan } from "@/lib/plans";
import { SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { assignPlanFromClientAction } from "../actions";

/**
 * Assign or change this client's plan from their own page.
 *
 * The full lifecycle — suspending, cancelling, extending a trial, overriding
 * seats — lives on the subscription's own screen. What is here is the one thing
 * an operator reaches for while looking at a client: putting them on a plan, or
 * moving them to a different one.
 *
 * Changing the plan re-reads the *published* price and snapshots it onto the
 * subscription, so this is a new agreement made today, not a silent repricing of
 * the old one.
 */
export function ClientSubscriptionPanel({
  csrfToken,
  companyId,
  companyName,
  plans,
  current,
}: {
  csrfToken: string;
  companyId: string;
  companyName: string;
  plans: PublicPlan[];
  current: { plan: string; billingCycle: string; status: string } | null;
}) {
  const [planCode, setPlanCode] = useState(current?.plan ?? plans[0]?.code ?? "");
  const selected = plans.find((plan) => plan.code === planCode);
  const changing = current !== null && planCode !== current.plan;

  if (plans.length === 0) {
    return (
      <AdminCard title="Subscription">
        <p className="text-[0.8125rem] leading-6 text-muted-ink">
          No plans are published, so nothing can be assigned yet.
        </p>
      </AdminCard>
    );
  }

  return (
    <AdminCard
      title={current ? "Change plan" : "Assign a subscription"}
      subtitle={
        current
          ? "Moves this client onto a different plan at the price published today"
          : "Creates the subscription for this company"
      }
    >
      <AdminForm action={assignPlanFromClientAction} csrfToken={csrfToken}>
        <input type="hidden" name="companyId" value={companyId} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AdminField label="Plan" required htmlFor="assign-plan">
            <select
              id="assign-plan"
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

          <AdminField label="Billing cycle" required htmlFor="assign-cycle">
            <select
              id="assign-cycle"
              name="billingCycle"
              defaultValue={current?.billingCycle ?? "MONTHLY"}
              required
              className={adminInputClass}
            >
              {BILLING_CYCLES.map((cycle) => (
                <option key={cycle} value={cycle}>
                  {CYCLE_LABELS[cycle]}
                </option>
              ))}
            </select>
          </AdminField>

          <AdminField label="Status" htmlFor="assign-status" hint="Leave as-is unless this is a new arrangement.">
            <select
              id="assign-status"
              name="status"
              defaultValue={current?.status ?? "TRIALING"}
              className={adminInputClass}
            >
              {SUBSCRIPTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {SUBSCRIPTION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </AdminField>
        </div>

        {changing && (
          <div className="mt-4">
            <AdminField
              label="Reason"
              htmlFor="assign-reason"
              hint="Recorded against the subscription and in the audit log."
            >
              <textarea
                id="assign-reason"
                name="reason"
                rows={2}
                className={adminTextareaClass}
                placeholder={`Why ${companyName} is moving from ${current?.plan} to ${planCode}.`}
              />
            </AdminField>
          </div>
        )}

        {selected && (
          <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
            {selected.name} allows {selected.seats} seats and {selected.companies}{" "}
            {selected.companies === 1 ? "company" : "companies"}. Lowering the allowance below the number of people
            who currently have access is refused rather than applied — nobody is removed automatically.
          </p>
        )}

        <div className="mt-4">
          <SubmitButton pendingLabel="Saving…">{current ? "Apply plan change" : "Create subscription"}</SubmitButton>
        </div>
      </AdminForm>
    </AdminCard>
  );
}
