"use client";

import { useState } from "react";
import {
  AdminField,
  AdminForm,
  adminInputClass,
  adminTextareaClass,
  ConfirmAction,
  SubmitButton,
} from "@/components/admin/forms";
import { AdminCard, DangerZone } from "@/components/admin/ui";
import {
  SUBSCRIPTION_STATUS_DESCRIPTIONS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_TRANSITIONS,
  requiresReason,
  type SubscriptionStatus,
} from "@/lib/subscriptions";
import {
  addNoteAction,
  changeStatusAction,
  extendTrialAction,
  overrideSeatsAction,
  setPeriodEndAction,
  setProviderRefAction,
} from "../actions";

/**
 * The lifecycle console for one subscription.
 *
 * Only the transitions that are legal from the current status are offered — the
 * table in `src/lib/subscriptions.ts` decides, and the server checks it again.
 * That is why there is no plain "set status" dropdown here: a console that lets
 * an operator drag a cancelled account back to trialing is a console that will
 * eventually be used to do exactly that by accident.
 */
export function SubscriptionLifecycle({
  csrfToken,
  subscriptionId,
  companyName,
  status,
  seats,
  seatsUsed,
  trialEndsAt,
  currentPeriodEnd,
  cancelAt,
  providerRef,
}: {
  csrfToken: string;
  subscriptionId: string;
  companyName: string;
  status: string;
  seats: number;
  seatsUsed: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  providerRef: string | null;
}) {
  const allowed = SUBSCRIPTION_TRANSITIONS[status as SubscriptionStatus] ?? [];
  const nonTerminal = allowed.filter((next) => next !== "CANCELLED");

  return (
    <div className="space-y-5">
      <AdminCard
        title="Lifecycle"
        subtitle={`Currently ${SUBSCRIPTION_STATUS_LABELS[status as SubscriptionStatus] ?? status.toLowerCase()} — ${
          SUBSCRIPTION_STATUS_DESCRIPTIONS[status as SubscriptionStatus] ?? ""
        }`}
      >
        {nonTerminal.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-ink">
            No status change is available from here except cancellation.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {nonTerminal.map((next) => (
              <ConfirmAction
                key={next}
                action={changeStatusAction}
                csrfToken={csrfToken}
                label={labelFor(next)}
                tone={next === "SUSPENDED" ? "danger" : "secondary"}
                title={`${labelFor(next)}?`}
                description={
                  <>
                    <strong>{companyName}</strong> moves from{" "}
                    {SUBSCRIPTION_STATUS_LABELS[status as SubscriptionStatus] ?? status} to{" "}
                    {SUBSCRIPTION_STATUS_LABELS[next]}.{" "}
                    {next === "SUSPENDED" &&
                      "Their company file becomes read-only immediately. Nothing is deleted, and every report still exports."}
                    {next === "ACTIVE" &&
                      "Normal access is restored and any suspension or past-due marker is cleared."}
                    {next === "PAST_DUE" &&
                      "Access continues during the grace period; this only marks the account as behind."}
                  </>
                }
                confirmLabel={labelFor(next)}
                reasonRequired={requiresReason(next)}
                hidden={{ subscriptionId, status: next }}
              />
            ))}
          </div>
        )}
      </AdminCard>

      <AdminCard title="Trial" subtitle={trialEndsAt ? `Ends ${trialEndsAt}` : "No trial end is set"}>
        <AdminForm action={extendTrialAction} csrfToken={csrfToken}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
            <AdminField label="Extend by (days)" htmlFor="trial-days">
              <input
                id="trial-days"
                name="days"
                type="number"
                min={1}
                max={365}
                defaultValue={14}
                className={adminInputClass}
              />
            </AdminField>
            <AdminField
              label="…or set an exact end date"
              htmlFor="trial-until"
              hint="A date here wins over the number of days."
            >
              <input id="trial-until" name="until" type="date" className={adminInputClass} />
            </AdminField>
            <SubmitButton tone="secondary">Extend trial</SubmitButton>
          </div>
          <div className="mt-3">
            <AdminField label="Reason" htmlFor="trial-reason">
              <input
                id="trial-reason"
                name="reason"
                className={adminInputClass}
                placeholder="e.g. Migration from their old system is running late."
              />
            </AdminField>
          </div>
        </AdminForm>
      </AdminCard>

      <AdminCard
        title="Seat allowance"
        subtitle={`${seatsUsed} of ${seats} seats in use`}
      >
        <SeatForm
          csrfToken={csrfToken}
          subscriptionId={subscriptionId}
          seats={seats}
          seatsUsed={seatsUsed}
        />
      </AdminCard>

      <AdminCard title="Billing period" subtitle={currentPeriodEnd ? `Ends ${currentPeriodEnd}` : "No period end set"}>
        <AdminForm action={setPeriodEndAction} csrfToken={csrfToken}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
            <AdminField label="Period ends" required htmlFor="period-end">
              <input id="period-end" name="currentPeriodEnd" type="date" required className={adminInputClass} />
            </AdminField>
            <AdminField label="Reason" htmlFor="period-reason">
              <input id="period-reason" name="reason" className={adminInputClass} placeholder="Optional" />
            </AdminField>
            <SubmitButton tone="secondary">Set period end</SubmitButton>
          </div>
        </AdminForm>

        <div className="mt-5 border-t border-paper-200 pt-4">
          <AdminForm action={setProviderRefAction} csrfToken={csrfToken}>
            <input type="hidden" name="subscriptionId" value={subscriptionId} />
            <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <AdminField
                label="Payment provider reference"
                htmlFor="provider-ref"
                hint="The processor's own subscription id, when one is connected. No card data is ever stored here."
              >
                <input
                  id="provider-ref"
                  name="providerRef"
                  defaultValue={providerRef ?? ""}
                  className={`${adminInputClass} font-mono`}
                  placeholder="sub_..."
                />
              </AdminField>
              <SubmitButton tone="secondary">Save reference</SubmitButton>
            </div>
          </AdminForm>
        </div>
      </AdminCard>

      <AdminCard title="Internal note" subtitle="Visible to Red Leaf only — never to the client">
        <AdminForm action={addNoteAction} csrfToken={csrfToken}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />
          <textarea
            name="body"
            rows={3}
            required
            className={adminTextareaClass}
            placeholder="Context the next person to open this account will want."
          />
          <div className="mt-3">
            <SubmitButton tone="secondary">Add note</SubmitButton>
          </div>
        </AdminForm>
      </AdminCard>

      <DangerZone title="Cancellation">
        {cancelAt ? (
          <p className="text-[0.8125rem] leading-6 text-ink-800">
            A cancellation is already scheduled for <strong>{cancelAt}</strong>. Restoring the subscription to active
            clears it.
          </p>
        ) : (
          <p className="text-[0.8125rem] leading-6 text-ink-800">
            Cancelling makes <strong>{companyName}</strong>&rsquo;s file read-only. Every posted entry, report and
            export remains available to them — cancellation ends the service, it does not take their books away.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {allowed.includes("CANCELLED") && (
            <>
              <ConfirmAction
                action={changeStatusAction}
                csrfToken={csrfToken}
                label="Schedule cancellation"
                tone="secondary"
                title="Cancel at the end of the current period?"
                description={
                  <>
                    <strong>{companyName}</strong> keeps working until{" "}
                    {currentPeriodEnd ?? trialEndsAt ?? "the end of their period"}, then becomes read-only. Nothing
                    changes today.
                  </>
                }
                confirmLabel="Schedule cancellation"
                reasonRequired
                hidden={{ subscriptionId, status: "CANCELLED", atPeriodEnd: "true" }}
              />

              <ConfirmAction
                action={changeStatusAction}
                csrfToken={csrfToken}
                label="Cancel immediately"
                title="Cancel this subscription right now?"
                description={
                  <>
                    <strong>{companyName}</strong>&rsquo;s file becomes read-only <em>immediately</em>. Everyone with
                    access keeps their login and can still read, report and export — but nothing further can be
                    posted. This is not the usual route: prefer scheduling it for the period end.
                  </>
                }
                confirmLabel="Cancel immediately"
                reasonRequired
                hidden={{ subscriptionId, status: "CANCELLED" }}
              />
            </>
          )}
        </div>
      </DangerZone>
    </div>
  );
}

function labelFor(status: SubscriptionStatus): string {
  switch (status) {
    case "ACTIVE":
      return "Activate";
    case "PAST_DUE":
      return "Mark past due";
    case "SUSPENDED":
      return "Suspend access";
    case "CANCELLED":
      return "Cancel";
    case "TRIALING":
    default:
      return "Start trial";
  }
}

/**
 * Seat changes are their own form because a reduction below current usage is
 * refused rather than applied — so the operator is warned before submitting,
 * not after.
 */
function SeatForm({
  csrfToken,
  subscriptionId,
  seats,
  seatsUsed,
}: {
  csrfToken: string;
  subscriptionId: string;
  seats: number;
  seatsUsed: number;
}) {
  const [value, setValue] = useState(seats);
  const tooLow = value < seatsUsed;

  return (
    <AdminForm action={overrideSeatsAction} csrfToken={csrfToken}>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr] sm:items-start">
        <AdminField label="Seats" required htmlFor="seats">
          <input
            id="seats"
            name="seats"
            type="number"
            min={1}
            required
            value={value}
            onChange={(event) => setValue(Number(event.target.value))}
            className={adminInputClass}
          />
        </AdminField>
        <AdminField
          label="Reason"
          required
          htmlFor="seats-reason"
          hint="A seat allowance different from the plan's is a commercial exception. It is flagged wherever the subscription appears."
        >
          <textarea
            id="seats-reason"
            name="reason"
            rows={2}
            required
            className={adminTextareaClass}
            placeholder="e.g. Contract signed for 20 seats at the Professional rate."
          />
        </AdminField>
      </div>

      {tooLow && (
        <p className="mt-3 rounded-md border border-[color:var(--color-caution)]/30 bg-caution-soft px-3 py-2 text-[0.75rem] leading-5 text-ink-800">
          {seatsUsed} people currently have access, so an allowance of {value} will be refused. Reducing a seat count
          never removes anyone — the client has to take access away first.
        </p>
      )}

      <div className="mt-4">
        <SubmitButton tone="secondary">Set seat allowance</SubmitButton>
      </div>
    </AdminForm>
  );
}
