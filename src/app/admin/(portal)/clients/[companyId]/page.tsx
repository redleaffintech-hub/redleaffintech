import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { getClient } from "@/server/admin/clients";
import { seatsUsed as countSeats } from "@/server/admin/subscriptions";
import { sellablePlans } from "@/server/plans/catalogue";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, relativeTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { CYCLE_BILLED_AS, CYCLE_LABELS, type BillingCycle } from "@/lib/plans";
import { accessFor } from "@/lib/subscriptions";
import { MODULE_CATALOG } from "@/lib/plans";
import { Badge, Callout } from "@/components/ui";
import {
  AdminCard,
  AdminPageHeader,
  DangerZone,
  DefinitionRow,
  OverrideTag,
  SubscriptionStatusBadge,
} from "@/components/admin/ui";
import { AccessPanel, type MembershipView } from "./access-panel";
import { ClientSubscriptionPanel } from "./subscription-panel";
import { ReadOnlyPanel } from "./read-only-panel";
import { ModulesPanel } from "./modules-panel";
import { DeleteClientPanel } from "./delete-client-panel";
import type { AdminParams } from "@/lib/admin-constants";

export async function generateMetadata({ params }: { params: AdminParams<"companyId"> }) {
  const { companyId } = await params;
  const company = await db.company.findUnique({ where: { id: companyId }, select: { name: true } });
  return { title: company?.name ?? "Client" };
}

/**
 * One client, end to end.
 *
 * Note what is deliberately absent: there is no balance, no invoice list, no
 * report. A platform administrator manages the *account*, not the bookkeeping,
 * and putting a revenue figure here — however useful it might occasionally be —
 * would make every support session a look inside a customer's finances.
 */
export default async function ClientDetailPage({ params }: { params: AdminParams<"companyId"> }) {
  const actor = await requirePlatformAdmin();
  const { companyId } = await params;

  const company = await getClient(companyId);
  if (!company) notFound();

  const [seatsUsed, plans, recentAudit] = await Promise.all([
    countSeats(companyId),
    sellablePlans(),
    db.platformAuditLog.findMany({
      where: { OR: [{ entityId: companyId }, { entityType: "Subscription", entityId: company.subscription?.id }] },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, summary: true, actorEmail: true, createdAt: true },
    }),
  ]);

  const subscription = company.subscription;
  const access = accessFor(subscription);

  const activePrimaries = company.users.filter(
    (member) => member.role === "PRIMARY" && member.status === "ACTIVE",
  );

  const memberships: MembershipView[] = company.users.map((member) => ({
    id: member.id,
    role: member.role,
    status: member.status,
    userId: member.user.id,
    userName: member.user.name,
    userEmail: member.user.email,
    lastLoginAt: member.user.lastLoginAt ? relativeTime(member.user.lastLoginAt) : null,
    isOnlyActivePrimary:
      member.role === "PRIMARY" && member.status === "ACTIVE" && activePrimaries.length === 1,
  }));

  return (
    <>
      <AdminPageHeader
        title={company.name}
        description={company.legalName && company.legalName !== company.name ? company.legalName : undefined}
        breadcrumb={[{ label: "Clients", href: "/admin/clients" }, { label: company.name }]}
        actions={
          <>
            {subscription && <SubscriptionStatusBadge status={subscription.status} />}
            {company.isReadOnly && <Badge tone="negative">read-only</Badge>}
            <Link
              href={`/admin/clients/${companyId}/edit`}
              className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
            >
              Edit details
            </Link>
            {subscription && (
              <Link
                href={`/admin/subscriptions/${subscription.id}`}
                className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
              >
                Manage subscription
              </Link>
            )}
          </>
        }
      />

      {!access.writable && (
        <div className="mb-4">
          <Callout tone="caution" title="This company file is read-only">
            {access.reason} Their books remain readable and exportable — nothing has been deleted or hidden.
          </Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="space-y-5">
          <AccessPanel
            csrfToken={actor.csrfToken}
            companyId={companyId}
            companyName={company.name}
            memberships={memberships}
            seatsUsed={seatsUsed}
            seatsAllowed={subscription?.seats ?? null}
            seatsOverridden={Boolean(subscription?.seatsOverridden)}
            seatOverrideReason={subscription?.seatOverrideReason ?? null}
          />

          <ModulesPanel
            // Remount (and so re-sync its local checkbox state) whenever the
            // company's real enabledModules changes underneath it, rather than
            // letting a stale local Set silently outlive a save — see the
            // comment on ModulesPanel.
            key={company.enabledModules.join(",")}
            csrfToken={actor.csrfToken}
            companyId={companyId}
            modules={MODULE_CATALOG}
            enabledModules={company.enabledModules}
          />

          <ClientSubscriptionPanel
            csrfToken={actor.csrfToken}
            companyId={companyId}
            companyName={company.name}
            plans={plans}
            current={
              subscription
                ? { plan: subscription.plan, billingCycle: subscription.billingCycle, status: subscription.status }
                : null
            }
          />

          <AdminCard title="Recent platform activity" subtitle="What Red Leaf has done to this account">
            {recentAudit.length === 0 ? (
              <p className="py-6 text-center text-[0.8125rem] text-muted-ink">
                Nothing has been changed from the platform console yet.
              </p>
            ) : (
              <ul className="divide-y divide-paper-200">
                {recentAudit.map((entry) => (
                  <li key={entry.id} className="py-2.5">
                    <p className="text-[0.8125rem] text-ink-900">{entry.summary}</p>
                    <p className="text-[0.75rem] text-muted-ink">
                      {entry.actorEmail} · {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 border-t border-paper-200 pt-3">
              <Link
                href={`/admin/audit?entityId=${companyId}`}
                className="text-[0.75rem] font-medium text-brand-700 hover:underline"
              >
                See the full audit trail for this client
              </Link>
            </div>
          </AdminCard>

          <DangerZone title="Access controls">
            <ReadOnlyPanel
              csrfToken={actor.csrfToken}
              companyId={companyId}
              companyName={company.name}
              isReadOnly={company.isReadOnly}
              lockedBySubscription={!access.writable && Boolean(subscription)}
            />
          </DangerZone>

          <DeleteClientPanel csrfToken={actor.csrfToken} companyId={companyId} companyName={company.name} />
        </div>

        <div className="space-y-5">
          <AdminCard title="Company">
            <dl>
              <DefinitionRow label="Operating name" value={company.name} />
              <DefinitionRow label="Legal name" value={company.legalName ?? "—"} />
              <DefinitionRow label="Email" value={company.email ?? "—"} />
              <DefinitionRow label="Phone" value={company.phone ?? "—"} />
              <DefinitionRow
                label="Location"
                value={`${company.province}${company.country !== "CA" ? ` · ${company.country}` : ""}`}
              />
              <DefinitionRow label="Base currency" value={company.baseCurrency} />
              <DefinitionRow
                label="Business number"
                value={company.businessNumber ? maskTail(company.businessNumber) : "—"}
              />
              <DefinitionRow label="Created" value={formatDate(company.createdAt)} />
              <DefinitionRow label="Firm" value={company.firm ? company.firm.name : "—"} />
            </dl>
          </AdminCard>

          <AdminCard title="Subscription">
            {subscription ? (
              <dl>
                <DefinitionRow label="Plan" value={subscription.plan} />
                <DefinitionRow
                  label="Status"
                  value={<SubscriptionStatusBadge status={subscription.status} />}
                />
                <DefinitionRow
                  label="Billing"
                  value={CYCLE_LABELS[subscription.billingCycle as BillingCycle] ?? subscription.billingCycle}
                />
                <DefinitionRow
                  label="Price"
                  value={
                    subscription.priceCents != null
                      ? `${formatMoney(subscription.priceCents, { currency: subscription.currency })} ${
                          CYCLE_BILLED_AS[subscription.billingCycle as BillingCycle] ?? ""
                        }`
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
                <DefinitionRow
                  label="Trial ends"
                  value={subscription.trialEndsAt ? formatDate(subscription.trialEndsAt) : "—"}
                />
                <DefinitionRow
                  label="Period ends"
                  value={subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}
                />
                {subscription.cancelAt && (
                  <DefinitionRow
                    label="Cancels on"
                    value={<span className="text-negative">{formatDate(subscription.cancelAt)}</span>}
                  />
                )}
                <DefinitionRow label="Provider reference" value={subscription.providerRef ?? "—"} />
              </dl>
            ) : (
              <p className="text-[0.8125rem] leading-6 text-muted-ink">
                This company has no subscription. Assign a plan below to create one.
              </p>
            )}
          </AdminCard>
        </div>
      </div>
    </>
  );
}

/**
 * A business number is a government identifier, not a secret — but it is not
 * needed at a glance either, and a console that prints every identifier in full
 * trains people to expect that.
 */
function maskTail(value: string): string {
  if (value.length <= 4) return value;
  return `${"•".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}
