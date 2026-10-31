import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { daysBetween, formatDate, today } from "@/lib/dates";
import { Badge, Callout, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui";
import {
  CYCLE_BILLED_AS,
  addonCycleCents,
  cyclePriceCents,
  cycleSavingPercent,
  monthlyEquivalentCents,
  type BillingCycle,
} from "@/lib/plans";
import { formatMoney } from "@/lib/money";
import { EXTRA_USER_PRICE_CENTS } from "@/lib/seats";
import { publicAddons, publicPlans } from "@/server/plans/catalogue";
import { SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { PlanPicker } from "./plan-picker";

export const metadata = { title: "Subscription" };

export default async function SubscriptionPage() {
  const { company } = await requireCapability(CAPABILITIES.SUBSCRIPTION);

  // Only what the public pricing page sells. Retired plans stay assignable by a
  // platform administrator for the companies still on them, but are never offered
  // here — that is how the old Starter/Professional/Business/Firm cards leaked
  // onto this screen after the pricing change.
  const [subscription, seatsUsed, plans, addons] = await Promise.all([
    db.subscription.findUnique({ where: { companyId: company.id } }),
    db.companyUser.count({ where: { companyId: company.id, status: { in: ["ACTIVE", "INVITED"] } } }),
    publicPlans(),
    publicAddons(),
  ]);

  const current = plans.find((plan) => plan.code === subscription?.plan);
  const onRetiredPlan = !!subscription && !current;
  const cycle: BillingCycle = subscription?.billingCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const trialDaysLeft = subscription?.trialEndsAt ? daysBetween(today(), subscription.trialEndsAt) : null;
  const enabled = new Set(company.enabledModules);
  const extraUserPrice = subscription?.extraSeatPriceCents ?? EXTRA_USER_PRICE_CENTS;

  return (
    <>
      <PageHeader
        title="Subscription"
        breadcrumb={[{ label: "Company", href: "/company" }, { label: "Subscription" }]}
        description="What this company file is on, what it costs, and how many of its users are in use."
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

      {onRetiredPlan && (
        <div className="mb-4">
          <Callout tone="info" title={`You are on the ${subscription.plan.toLowerCase()} plan, which is no longer sold`}>
            It keeps working exactly as it does today. Our current plan is below — you can switch to it whenever you
            like.
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <CardHeader title="Plan" subtitle="Everything in the accounting product, one price" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {plans.map((plan) => {
                const isCurrent = plan.code === subscription?.plan;
                const saving = cycleSavingPercent(plan, "ANNUAL");
                return (
                  <div
                    key={plan.id}
                    className={
                      isCurrent
                        ? "rounded-lg border-2 border-brand-500 bg-brand-soft p-4"
                        : "rounded-lg border border-paper-300 p-4"
                    }
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-[0.9375rem] font-semibold text-ink-900">{plan.name}</h3>
                      {isCurrent && <Badge tone="accent">current</Badge>}
                    </div>
                    <p className="tnum mt-1 text-[1.5rem] font-semibold text-ink-950">
                      {formatMoney(cyclePriceCents(plan, "MONTHLY"), { currency: plan.currency })}
                      <span className="text-[0.75rem] font-normal text-muted-ink"> /month</span>
                    </p>
                    <p className="tnum text-[0.8125rem] text-ink-700">
                      or {formatMoney(cyclePriceCents(plan, "ANNUAL"), { currency: plan.currency })} /year (
                      {formatMoney(monthlyEquivalentCents(plan, "ANNUAL"), { currency: plan.currency })}/month
                      {saving > 0 ? `, save ${saving}%` : ""})
                    </p>
                    {plan.forWhom && <p className="mt-2 text-[0.75rem] leading-5 text-muted-ink">{plan.forWhom}</p>}
                    <p className="mt-2 text-[0.75rem] font-medium text-ink-700">
                      {plan.seats} users included · extra users {formatMoney(extraUserPrice)}/user/month
                    </p>
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
                        isCurrent={isCurrent}
                        seatsUsed={seatsUsed}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <CardHeader title="Add-ons" subtitle="Add a product to your plan when you need it" />
            <ul className="mt-3 divide-y divide-paper-300">
              {addons.map((addon) => {
                const on = enabled.has(addon.moduleId);
                return (
                  <li key={addon.code} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="max-w-md">
                      <p className="text-[0.9375rem] font-semibold text-ink-900">{addon.name}</p>
                      {addon.description && (
                        <p className="mt-0.5 text-[0.75rem] leading-5 text-muted-ink">{addon.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="tnum text-[0.9375rem] font-semibold text-ink-950">
                        {formatMoney(addonCycleCents(addon, "MONTHLY"), { currency: addon.currency })}
                        <span className="text-[0.75rem] font-normal text-muted-ink"> /month</span>
                      </p>
                      <p className="tnum text-[0.75rem] text-muted-ink">
                        or {formatMoney(addonCycleCents(addon, "ANNUAL"), { currency: addon.currency })} /year
                      </p>
                      <div className="mt-1.5">
                        {on ? <Badge tone="positive">Active on this company</Badge> : <Badge tone="neutral">Not added</Badge>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[0.75rem] leading-5 text-muted-ink">
              To add or remove an add-on, contact Red Leaf support — it is switched on for your company straight away.
            </p>
          </Card>

          <Card className="p-5">
            <CardHeader title="Users" subtitle="Included in your plan, and how to add more" />
            <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
              Every company includes 2 users — the owner/admin and your accountant. Each additional user is{" "}
              <span className="font-medium text-ink-800">{formatMoney(extraUserPrice)} per month</span> and is approved by
              Red Leaf before it can be added. Request them from{" "}
              <Link href="/company/users" className="font-medium underline">
                Users &amp; access
              </Link>
              ; the total is shown before you submit.
            </p>
          </Card>

          <p className="text-[0.75rem] leading-5 text-muted-ink">
            No payment processor is connected in this build, so changing a plan only changes what the file records.
            Nothing is charged.
          </p>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Current" />
            {subscription ? (
              <dl className="mt-3 space-y-2.5 text-[0.8125rem]">
                <Row label="Plan" value={current?.name ?? subscription.plan} />
                <Row label="Status" value={SUBSCRIPTION_STATUS_LABELS[subscription.status as never] ?? subscription.status} />
                <Row label="Billing" value={cycle === "ANNUAL" ? "Annual" : "Monthly"} />
                <Row label="Users" value={`${seatsUsed} of ${subscription.seats} used`} />
                {subscription.extraSeats > 0 && (
                  <Row
                    label="Additional users"
                    value={`${subscription.extraSeats} × ${formatMoney(subscription.extraSeatPriceCents)} = ${formatMoney(subscription.extraSeats * subscription.extraSeatPriceCents)} / month`}
                  />
                )}
                <Row label="Trial ends" value={subscription.trialEndsAt ? formatDate(subscription.trialEndsAt) : "—"} />
                <Row
                  label="Period ends"
                  value={subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}
                />
                <Row
                  label="Plan price"
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
