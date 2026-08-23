"use client";

import { useState } from "react";
import { AdminField, AdminForm, adminInputClass, adminTextareaClass, SubmitButton } from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { formatMoney } from "@/lib/money";
import { BILLING_CYCLES, CYCLE_BILLED_AS, CYCLE_LABELS, type BillingCycle, type PublicPlan } from "@/lib/plans";
import { changePlanAction } from "../actions";

/**
 * Move this subscription onto a different plan or cycle.
 *
 * The panel quotes the price *before* the operator commits, taken from the same
 * published snapshot the sale will use. Assigning a plan is a new agreement made
 * today — the figure shown here is what gets frozen onto the row, and it will
 * not move again until somebody does this deliberately.
 */
export function PlanChangePanel({
  csrfToken,
  subscriptionId,
  companyId,
  companyName,
  plans,
  currentPlan,
  currentCycle,
}: {
  csrfToken: string;
  subscriptionId: string;
  companyId: string;
  companyName: string;
  plans: PublicPlan[];
  currentPlan: string;
  currentCycle: string;
}) {
  const [planCode, setPlanCode] = useState(currentPlan);
  const [cycle, setCycle] = useState<BillingCycle>(
    (BILLING_CYCLES as readonly string[]).includes(currentCycle) ? (currentCycle as BillingCycle) : "MONTHLY",
  );

  const selected = plans.find((plan) => plan.code === planCode);
  const price = selected?.prices[cycle];
  const changed = planCode !== currentPlan || cycle !== currentCycle;

  return (
    <AdminCard title="Plan" subtitle="Assigning re-reads the published price and freezes it onto this subscription">
      {plans.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-ink">
          No plans are published, so nothing can be assigned. Publish one first.
        </p>
      ) : (
        <AdminForm action={changePlanAction} csrfToken={csrfToken}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <input type="hidden" name="companyId" value={companyId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <AdminField label="Plan" required htmlFor="change-plan">
              <select
                id="change-plan"
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
                {!plans.some((plan) => plan.code === currentPlan) && (
                  <option value={currentPlan}>{currentPlan} (no longer published)</option>
                )}
              </select>
            </AdminField>

            <AdminField label="Billing cycle" required htmlFor="change-cycle">
              <select
                id="change-cycle"
                name="billingCycle"
                required
                value={cycle}
                onChange={(event) => setCycle(event.target.value as BillingCycle)}
                className={adminInputClass}
              >
                {BILLING_CYCLES.map((option) => (
                  <option key={option} value={option}>
                    {CYCLE_LABELS[option]}
                  </option>
                ))}
              </select>
            </AdminField>
          </div>

          {price && selected && (
            <p className="mt-3 rounded-md bg-paper-200 px-3 py-2 text-[0.8125rem] leading-6 text-ink-800">
              <strong>{companyName}</strong> will be charged{" "}
              <strong>{formatMoney(price.cycleAmountCents, { currency: selected.currency })}</strong>{" "}
              {CYCLE_BILLED_AS[cycle]} ({formatMoney(price.monthlyEquivalentCents, { currency: selected.currency })}{" "}
              per month equivalent), with {selected.seats} seats included.
            </p>
          )}

          {changed && (
            <div className="mt-4">
              <AdminField label="Reason" htmlFor="change-reason" hint="Recorded on the subscription and in the audit log.">
                <textarea
                  id="change-reason"
                  name="reason"
                  rows={2}
                  className={adminTextareaClass}
                  placeholder="Why the terms are changing."
                />
              </AdminField>
            </div>
          )}

          <div className="mt-4">
            <SubmitButton disabled={!changed} pendingLabel="Applying…">
              {changed ? "Apply plan change" : "No change to apply"}
            </SubmitButton>
          </div>
        </AdminForm>
      )}
    </AdminCard>
  );
}
