import { getSubscriptionForCompany } from "@/server/db/platform";
import { listMembershipsForCompany } from "@/server/db/company-users";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { daysBetween, formatDate, today } from "@/lib/dates";
import { Badge, Callout, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui";
import { CYCLE_BILLED_AS, monthlyEquivalentCents, type BillingCycle } from "@/lib/plans";
import { formatMoney } from "@/lib/money";
import { sellablePlans } from "@/server/plans/catalogue";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { PlanPicker } from "./plan-picker";

export const metadata = { title: "Subscription" };


export default async function SubscriptionPage() {
  const { company } = await requireCapability(CAPABILITIES.SUBSCRIPTION);

  // The same published catalogue the marketing site quotes from, so a customer
  // is never offered a plan or a price the public page does not show.
  const [subscription, memberships, plans] = await Promise.all([
    getSubscriptionForCompany(company.id),
    listMembershipsForCompany(company.id),
    sellablePlans(),
  ]);
  const seatsUsed = memberships.filter((m) => ["ACTIVE", "INVITED"].includes(m.status)).length;

  const current = plans.find((plan) => plan.code === subscription?.plan);
  const trialDaysLeft = subscription?.trialEndsAt ? daysBetween(today(), subscription.trialEndsAt) : null;

  return (
    <>
      <PageHeader
        title="Subscription"
        breadcrumb={[{ label: "Company", href: "/company" }, { label: "Subscription" }]}
        description="What this company file is on, and how many of its seats are in use."
        actions={subscription ? <StatusBadge status={subscription.status} /> : undefined}
      />

      {subscription?.status === "TRIALING" && trialDaysLeft !== null && (
        <div className="mb-4">
          <Callout
            tone={trialDaysLeft <= 7 ? "caution" : "info"}
            title={trialDaysLeft > 0 ? `${trialDaysLeft} days left in the trial` : "The trial has ended"}
          >
            The trial ends {formatDate(subscription.trialEndsAt)}. Your data is not touched when a trial lapses — the
            books stay readable and exportable.
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <Card className="p-5">
          <CardHeader title="Plans" subtitle="Change takes effect immediately; billing is not wired up in this build" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={
                  plan.code === subscription?.plan
                    ? "rounded-lg border-2 border-brand-500 bg-brand-soft p-4"
                    : "rounded-lg border border-paper-300 p-4"
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[0.9375rem] font-semibold text-ink-900">{plan.name}</h3>
                  {plan.code === subscription?.plan && <Badge tone="accent">current</Badge>}
                </div>
                <p className="tnum mt-1 text-[1.25rem] font-semibold text-ink-950">
                  ${(monthlyEquivalentCents(plan, "MONTHLY") / 100).toFixed(0)}
                  <span className="text-[0.75rem] font-normal text-muted-ink"> /month</span>
                </p>
                <p className="mt-1 text-[0.75rem] leading-5 text-muted-ink">{plan.forWhom}</p>
                <p className="mt-2 text-[0.75rem] font-medium text-ink-700">{plan.seats} seats</p>
                <ul className="mt-2 space-y-1 text-[0.75rem] leading-5 text-muted-ink">
                  {plan.includes.map((line) => (
                    <li key={line}>· {line}</li>
                  ))}
                </ul>
                <div className="mt-3">
                  <PlanPicker
                    plan={plan.code}
                    planName={plan.name}
                    seats={plan.seats}
                    isCurrent={plan.code === subscription?.plan}
                    seatsUsed={seatsUsed}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[0.75rem] leading-5 text-muted-ink">
            No payment processor is connected in this build, so changing a plan only changes the seat limit and what the
            file records. Nothing is charged.
          </p>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Current" />
            {subscription ? (
              <dl className="mt-3 space-y-2.5 text-[0.8125rem]">
                <Row label="Plan" value={current?.name ?? subscription.plan} />
                <Row label="Status" value={SUBSCRIPTION_STATUS_LABELS[subscription.status as never] ?? subscription.status} />
                <Row label="Seats" value={`${seatsUsed} of ${subscription.seats} used`} />
                <Row label="Trial ends" value={subscription.trialEndsAt ? formatDate(subscription.trialEndsAt) : "—"} />
                <Row
                  label="Period ends"
                  value={subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}
                />
                <Row
                  label="Price"
                  value={
                    subscription.priceCents != null
                      ? `${formatMoney(subscription.priceCents, { currency: subscription.currency })} ${
                          CYCLE_BILLED_AS[subscription.billingCycle as BillingCycle] ?? ""
                        }`
                      : "—"
                  }
                />
                <Row label="Started" value={formatDate(subscription.createdAt)} />
              </dl>
            ) : (
              <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
                This company has no subscription record. Choose a plan to create one.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Your data" />
            <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
              The books belong to the company, not the plan. Every report exports, and the ledger can be extracted in
              full — downgrading or cancelling never deletes a posted entry.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
