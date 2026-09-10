import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { seatsUsed as countSeats } from "@/server/admin/subscriptions";
import { sellablePlans } from "@/server/plans/catalogue";
import {
  subscriptions as subscriptionsRepo,
  plans as plansRepo,
  planVersions as planVersionsRepo,
  listSubscriptionEvents,
  listSubscriptionNotes,
} from "@/server/db/platform";
import { getCompany } from "@/server/db/companies";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { CYCLE_BILLED_AS, CYCLE_LABELS, type BillingCycle } from "@/lib/plans";
import { accessFor } from "@/lib/subscriptions";
import { Callout } from "@/components/ui";
import {
  AdminCard,
  AdminPageHeader,
  DefinitionRow,
  OverrideTag,
  SubscriptionStatusBadge,
} from "@/components/admin/ui";
import { SubscriptionLifecycle } from "./lifecycle";
import { PlanChangePanel } from "./plan-change-panel";
import type { AdminParams } from "@/lib/admin-constants";

export async function generateMetadata({ params }: { params: AdminParams<"subscriptionId"> }) {
  const { subscriptionId } = await params;
  const subscription = await subscriptionsRepo.get(subscriptionId);
  const company = subscription ? await getCompany(subscription.companyId) : null;
  return { title: company ? `${company.name} subscription` : "Subscription" };
}

/**
 * One subscription's whole story.
 *
 * The "agreed price" panel is the important one to read carefully. It shows what
 * was frozen onto this row when the plan was assigned, alongside what the plan
 * currently publishes — and says plainly when the two have diverged. That is the
 * concrete form of the rule that editing a public price must never rewrite an
 * existing customer's terms.
 */
export default async function SubscriptionDetailPage({
  params,
}: { params: AdminParams<"subscriptionId"> }) {
  const actor = await requirePlatformAdmin();
  const { subscriptionId } = await params;

  const raw = await subscriptionsRepo.get(subscriptionId);
  if (!raw) notFound();

  const [companyRecord, planRecord, planVersion, events, notes, seatsUsed, plans] = await Promise.all([
    getCompany(raw.companyId),
    raw.planId ? plansRepo.get(raw.planId) : Promise.resolve(null),
    raw.planVersionId ? planVersionsRepo.get(raw.planVersionId) : Promise.resolve(null),
    listSubscriptionEvents(raw.id),
    listSubscriptionNotes(raw.id),
    countSeats(raw.companyId),
    sellablePlans(),
  ]);
  const subscription = {
    ...raw,
    company: {
      id: raw.companyId,
      name: companyRecord?.name ?? "—",
      isReadOnly: companyRecord?.isReadOnly ?? false,
    },
    planRecord: planRecord
      ? { id: planRecord.id, code: planRecord.code, name: planRecord.name, seats: planRecord.seats }
      : null,
    planVersion: planVersion
      ? { version: planVersion.version, publishedAt: planVersion.publishedAt }
      : null,
    events: [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 25),
    notes: [...notes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 20),
  };

  const livePlan = plans.find((plan) => plan.code === subscription.plan);
  const livePrice = livePlan?.prices[subscription.billingCycle as BillingCycle]?.cycleAmountCents ?? null;
  const priceDiverged =
    livePrice != null && subscription.priceCents != null && livePrice !== subscription.priceCents;

  const access = accessFor(subscription);

  return (
    <>
      <AdminPageHeader
        title={subscription.company.name}
        description="Subscription, entitlements and commercial state."
        breadcrumb={[
          { label: "Subscriptions", href: "/admin/subscriptions" },
          { label: subscription.company.name },
        ]}
        actions={
          <>
            <SubscriptionStatusBadge status={subscription.status} />
            <Link
              href={`/admin/clients/${subscription.companyId}`}
              className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
            >
              Open client
            </Link>
          </>
        }
      />

      {!access.writable && (
        <div className="mb-4">
          <Callout tone="caution" title="This client's file is read-only">
            {access.reason}
          </Callout>
        </div>
      )}

      {subscription.cancelAt && (
        <div className="mb-4">
          <Callout tone="caution" title="Cancellation scheduled">
            This subscription is set to end on {formatDate(subscription.cancelAt)}. Activating it again clears the
            schedule.
          </Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="space-y-5">
          <PlanChangePanel
            csrfToken={actor.csrfToken}
            subscriptionId={subscription.id}
            companyId={subscription.companyId}
            companyName={subscription.company.name}
            plans={plans}
            currentPlan={subscription.plan}
            currentCycle={subscription.billingCycle}
          />

          <SubscriptionLifecycle
            csrfToken={actor.csrfToken}
            subscriptionId={subscription.id}
            companyName={subscription.company.name}
            status={subscription.status}
            seats={subscription.seats}
            seatsUsed={seatsUsed}
            trialEndsAt={subscription.trialEndsAt ? formatDate(subscription.trialEndsAt) : null}
            currentPeriodEnd={subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : null}
            cancelAt={subscription.cancelAt ? formatDate(subscription.cancelAt) : null}
            providerRef={subscription.providerRef}
          />

          <AdminCard title="History" subtitle="Every change made to this subscription">
            {subscription.events.length === 0 ? (
              <p className="py-6 text-center text-[0.8125rem] text-muted-ink">Nothing has changed yet.</p>
            ) : (
              <ol className="space-y-3">
                {subscription.events.map((event) => (
                  <li key={event.id} className="border-l-2 border-paper-300 pl-3">
                    <p className="text-[0.8125rem] font-medium text-ink-900">{event.summary}</p>
                    {event.reason && (
                      <p className="mt-0.5 text-[0.75rem] italic leading-5 text-ink-700">“{event.reason}”</p>
                    )}
                    <p className="mt-0.5 text-[0.75rem] text-muted-ink">
                      {event.actorEmail ?? "system"} · {formatDateTime(event.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </AdminCard>

          <AdminCard title="Internal notes">
            {subscription.notes.length === 0 ? (
              <p className="py-6 text-center text-[0.8125rem] text-muted-ink">No notes on this account.</p>
            ) : (
              <ul className="divide-y divide-paper-200">
                {subscription.notes.map((note) => (
                  <li key={note.id} className="py-2.5">
                    <p className="whitespace-pre-wrap text-[0.8125rem] leading-6 text-ink-800">{note.body}</p>
                    <p className="mt-1 text-[0.75rem] text-muted-ink">
                      {note.authorEmail ?? "unknown"} · {formatDateTime(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>

        <div className="space-y-5">
          <AdminCard title="Agreed terms" subtitle="Frozen when the plan was assigned">
            <dl>
              <DefinitionRow
                label="Plan"
                value={subscription.planRecord ? subscription.planRecord.name : subscription.plan}
              />
              <DefinitionRow
                label="Billing cycle"
                value={CYCLE_LABELS[subscription.billingCycle as BillingCycle] ?? subscription.billingCycle}
              />
              <DefinitionRow
                label="Charged"
                value={
                  subscription.priceCents != null
                    ? `${formatMoney(subscription.priceCents, { currency: subscription.currency })} ${
                        CYCLE_BILLED_AS[subscription.billingCycle as BillingCycle] ?? ""
                      }`
                    : "—"
                }
              />
              <DefinitionRow
                label="Monthly equivalent"
                value={
                  subscription.monthlyEquivalentCents != null
                    ? formatMoney(subscription.monthlyEquivalentCents, { currency: subscription.currency })
                    : "—"
                }
              />
              <DefinitionRow
                label="Plan version"
                value={
                  subscription.planVersion
                    ? `v${subscription.planVersion.version} · ${formatDate(subscription.planVersion.publishedAt)}`
                    : "—"
                }
              />
              <DefinitionRow
                label="Seats"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {seatsUsed} of {subscription.seats}
                    {subscription.seatsOverridden && <OverrideTag reason={subscription.seatOverrideReason} />}
                  </span>
                }
              />
            </dl>

            {priceDiverged && (
              <p className="mt-3 rounded-md border border-[color:var(--color-info)]/25 bg-info-soft px-3 py-2 text-[0.75rem] leading-5 text-ink-800">
                The published price for {subscription.plan} is now{" "}
                {formatMoney(livePrice!, { currency: livePlan!.currency })}. This client keeps the price they were
                sold on until somebody deliberately reassigns their plan.
              </p>
            )}

            {subscription.seatOverrideReason && (
              <p className="mt-3 rounded-md bg-paper-200 px-3 py-2 text-[0.75rem] leading-5 text-ink-700">
                <span className="font-medium">Seat override:</span> {subscription.seatOverrideReason}
                {subscription.seatOverrideAt && ` (${formatDate(subscription.seatOverrideAt)})`}
              </p>
            )}
          </AdminCard>

          <AdminCard title="Dates">
            <dl>
              <DefinitionRow label="Created" value={formatDate(subscription.createdAt)} />
              <DefinitionRow
                label="Started"
                value={subscription.startedAt ? formatDate(subscription.startedAt) : "—"}
              />
              <DefinitionRow
                label="Trial"
                value={
                  subscription.trialEndsAt
                    ? `${subscription.trialStartsAt ? `${formatDate(subscription.trialStartsAt)} – ` : ""}${formatDate(
                        subscription.trialEndsAt,
                      )}`
                    : "—"
                }
              />
              <DefinitionRow
                label="Current period"
                value={
                  subscription.currentPeriodEnd
                    ? `${
                        subscription.currentPeriodStart ? `${formatDate(subscription.currentPeriodStart)} – ` : ""
                      }${formatDate(subscription.currentPeriodEnd)}`
                    : "—"
                }
              />
              {subscription.pastDueSince && (
                <DefinitionRow label="Past due since" value={formatDate(subscription.pastDueSince)} />
              )}
              {subscription.suspendedAt && (
                <DefinitionRow label="Suspended" value={formatDate(subscription.suspendedAt)} />
              )}
              {subscription.cancelledAt && (
                <DefinitionRow label="Cancelled" value={formatDate(subscription.cancelledAt)} />
              )}
              <DefinitionRow label="Last changed" value={formatDateTime(subscription.updatedAt)} />
            </dl>

            {(subscription.suspendReason || subscription.cancelReason) && (
              <p className="mt-3 rounded-md bg-paper-200 px-3 py-2 text-[0.75rem] leading-5 text-ink-700">
                <span className="font-medium">Reason given:</span>{" "}
                {subscription.suspendReason ?? subscription.cancelReason}
              </p>
            )}
          </AdminCard>

          <AdminCard title="Audit">
            <Link
              href={`/admin/audit?entityId=${subscription.id}`}
              className="text-[0.8125rem] font-medium text-brand-700 hover:underline"
            >
              Full platform audit trail for this subscription
            </Link>
            <p className="mt-2 text-[0.75rem] leading-5 text-muted-ink">
              The history panel is the quick view; the audit log carries the before and after values, the acting
              administrator, and the address they acted from.
            </p>
          </AdminCard>
        </div>
      </div>
    </>
  );
}
