import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { getPlanForAdmin } from "@/server/plans/admin";
import { planShapeFromRow } from "@/server/plans/catalogue";
import { plans as plansRepo, planVersions as planVersionsRepo, subscriptions as subscriptionsRepo } from "@/server/db/platform";
import { getCompany } from "@/server/db/companies";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  BILLING_CYCLES,
  CYCLE_BILLED_AS,
  CYCLE_LABELS,
  MODULE_NAMES,
  PLAN_STATUS_LABELS,
  type BillingCycle,
  type PlanStatus,
  type PublicPlan,
} from "@/lib/plans";
import { Badge, Callout, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, DefinitionRow, EmptyRow } from "@/components/admin/ui";
import { PlanRowActions } from "../row-actions";
import type { AdminParams } from "@/lib/admin-constants";

export async function generateMetadata({ params }: { params: AdminParams<"id"> }) {
  const { id } = await params;
  const plan = await plansRepo.get(id);
  return { title: plan?.name ?? "Plan" };
}

/**
 * One plan: the working copy, the published snapshot, and the difference.
 *
 * The comparison table is the point of this page. An operator needs to be able
 * to answer "what will change when I publish?" without reading two forms side by
 * side, because that question is what stands between a considered price rise and
 * an accidental one.
 */
export default async function PlanDetailPage({ params }: { params: AdminParams<"id"> }) {
  const actor = await requirePlatformAdmin();
  const { id } = await params;

  const plan = await getPlanForAdmin(id);
  if (!plan) notFound();

  const working = planShapeFromRow(plan);

  const publishedVersion = plan.publishedVersionId
    ? plan.versions.find((version) => version.id === plan.publishedVersionId)
    : null;
  const published = publishedVersion ? safeParse(publishedVersion.snapshot) : null;

  const rawSubs = (await subscriptionsRepo.list({ where: [["planId", "==", plan.id]] }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);
  const subscriptions = await Promise.all(
    rawSubs.map(async (s) => {
      const [company, planVersion] = await Promise.all([
        s.companyId ? getCompany(s.companyId) : Promise.resolve(null),
        s.planVersionId ? planVersionsRepo.get(s.planVersionId) : Promise.resolve(null),
      ]);
      return {
        id: s.id,
        status: s.status,
        billingCycle: s.billingCycle,
        priceCents: s.priceCents,
        currency: s.currency,
        company: { id: s.companyId, name: company?.name ?? "—" },
        planVersion: planVersion ? { version: planVersion.version } : null,
      };
    }),
  );

  const differences = published ? diff(published, working) : [];

  return (
    <>
      <AdminPageHeader
        title={plan.name}
        description={plan.description ?? plan.forWhom ?? undefined}
        breadcrumb={[{ label: "Plans & pricing", href: "/admin/plans" }, { label: plan.name }]}
        actions={
          <PlanRowActions
            csrfToken={actor.csrfToken}
            planId={plan.id}
            planName={plan.name}
            planCode={plan.code}
            status={plan.status}
            isPublic={plan.isPublic}
            isArchived={Boolean(plan.archivedAt)}
            hasDraftChanges={plan.hasDraftChanges}
            subscriptionCount={plan._count.subscriptions}
          />
        }
      />

      {plan.hasDraftChanges && (
        <div className="mb-4">
          <Callout tone="caution" title="This plan has unpublished changes">
            {published
              ? "Visitors still see the last published version. Publishing replaces it with the working copy below."
              : "This plan has never been published, so it appears nowhere yet."}
          </Callout>
        </div>
      )}

      {plan.archivedAt && (
        <div className="mb-4">
          <Callout tone="info" title="Archived">
            Withdrawn from sale on {formatDate(plan.archivedAt)}. The {plan._count.subscriptions} subscription
            {plan._count.subscriptions === 1 ? "" : "s"} on it keep their agreed terms.
          </Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div className="space-y-5">
          {differences.length > 0 && (
            <AdminCard title="What publishing will change" subtitle="Working copy compared with the live snapshot">
              <Table>
                <thead>
                  <tr>
                    <Th>Field</Th>
                    <Th>Live now</Th>
                    <Th>After publishing</Th>
                  </tr>
                </thead>
                <tbody>
                  {differences.map((row) => (
                    <Tr key={row.label}>
                      <Td>{row.label}</Td>
                      <Td className="text-muted-ink">{row.before}</Td>
                      <Td className="font-medium text-ink-900">{row.after}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </AdminCard>
          )}

          <AdminCard title="Pricing (working copy)">
            <Table>
              <thead>
                <tr>
                  <Th>Cycle</Th>
                  <Th align="right">Per month</Th>
                  <Th align="right">Billed</Th>
                  <Th>Phrasing</Th>
                </tr>
              </thead>
              <tbody>
                {BILLING_CYCLES.map((cycle) => (
                  <Tr key={cycle}>
                    <Td>{CYCLE_LABELS[cycle]}</Td>
                    <Td align="right" className="tabular-nums">
                      {formatMoney(working.prices[cycle].monthlyEquivalentCents, { currency: working.currency })}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatMoney(working.prices[cycle].cycleAmountCents, { currency: working.currency })}
                    </Td>
                    <Td className="text-muted-ink">{CYCLE_BILLED_AS[cycle]}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </AdminCard>

          <AdminCard title="Subscriptions on this plan" subtitle="The price each was sold at, not today's">
            <Table>
              <thead>
                <tr>
                  <Th>Client</Th>
                  <Th>Status</Th>
                  <Th>Cycle</Th>
                  <Th align="right">Agreed price</Th>
                  <Th align="right">Version</Th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.length === 0 ? (
                  <EmptyRow colSpan={5}>Nothing is on this plan yet.</EmptyRow>
                ) : (
                  subscriptions.map((subscription) => (
                    <Tr key={subscription.id}>
                      <Td>
                        <Link
                          href={`/admin/subscriptions/${subscription.id}`}
                          className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                        >
                          {subscription.company.name}
                        </Link>
                      </Td>
                      <Td className="text-muted-ink">{subscription.status.replace(/_/g, " ").toLowerCase()}</Td>
                      <Td>{CYCLE_LABELS[subscription.billingCycle as BillingCycle] ?? subscription.billingCycle}</Td>
                      <Td align="right" className="tabular-nums">
                        {subscription.priceCents != null
                          ? formatMoney(subscription.priceCents, { currency: subscription.currency })
                          : "—"}
                      </Td>
                      <Td align="right" className="tabular-nums text-muted-ink">
                        {subscription.planVersion ? `v${subscription.planVersion.version}` : "—"}
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
            {plan._count.subscriptions > subscriptions.length && (
              <p className="mt-3 text-[0.75rem] text-muted-ink">
                Showing {subscriptions.length} of {plan._count.subscriptions}.{" "}
                <Link
                  href={`/admin/subscriptions?plan=${plan.code}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  See all
                </Link>
                .
              </p>
            )}
          </AdminCard>

          <AdminCard title="Publication history">
            {plan.versions.length === 0 ? (
              <p className="py-6 text-center text-[0.8125rem] text-muted-ink">Never published.</p>
            ) : (
              <ul className="divide-y divide-paper-200">
                {plan.versions.map((version) => (
                  <li key={version.id} className="flex items-baseline justify-between gap-3 py-2.5">
                    <span className="text-[0.8125rem] text-ink-900">
                      Version {version.version}
                      {version.id === plan.publishedVersionId && (
                        <Badge tone="positive" className="ml-2">
                          live
                        </Badge>
                      )}
                    </span>
                    <span className="text-[0.75rem] text-muted-ink">{formatDateTime(version.publishedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>

        <div className="space-y-5">
          <AdminCard title="Details">
            <dl>
              <DefinitionRow label="Code" value={<span className="font-mono">{plan.code}</span>} />
              <DefinitionRow
                label="Status"
                value={PLAN_STATUS_LABELS[plan.status as PlanStatus] ?? plan.status}
              />
              <DefinitionRow label="On the public page" value={plan.isPublic ? "Yes" : "No"} />
              <DefinitionRow label="Contact sales only" value={plan.contactOnly ? "Yes" : "No"} />
              <DefinitionRow label="Most popular" value={plan.isPopular ? "Yes" : "No"} />
              <DefinitionRow label="Display order" value={plan.sortOrder} />
              <DefinitionRow label="Currency" value={plan.currency} />
              <DefinitionRow label="Seats" value={plan.seats} />
              <DefinitionRow label="Companies" value={plan.companies} />
              <DefinitionRow label="Storage" value={`${plan.storageGb} GB`} />
              <DefinitionRow label="Support" value={plan.support} />
              <DefinitionRow label="Created" value={formatDate(plan.createdAt)} />
            </dl>
          </AdminCard>

          <AdminCard title="Included modules">
            {working.modules.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-ink">None selected.</p>
            ) : (
              <ul className="space-y-1.5">
                {working.modules.map((module) => (
                  <li key={module} className="text-[0.8125rem] text-ink-800">
                    {MODULE_NAMES[module] ?? module}
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>

          <AdminCard title="Feature list">
            {working.includes.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-ink">No bullets yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {working.includes.map((feature, index) => (
                  <li key={`${feature}-${index}`} className="text-[0.8125rem] leading-6 text-ink-800">
                    · {feature}
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>
    </>
  );
}

function safeParse(raw: string): PublicPlan | null {
  try {
    return JSON.parse(raw) as PublicPlan;
  } catch {
    return null;
  }
}

/**
 * The publish diff.
 *
 * Only the fields a customer or the entitlement layer would notice — deliberately
 * not a generic object diff, which would surface `sortOrder` churn and other
 * noise that has already taken effect anyway.
 */
function diff(before: PublicPlan, after: PublicPlan): { label: string; before: string; after: string }[] {
  const rows: { label: string; before: string; after: string }[] = [];

  const compare = (label: string, a: string | number, b: string | number) => {
    if (String(a) !== String(b)) rows.push({ label, before: String(a), after: String(b) });
  };

  compare("Name", before.name, after.name);
  compare("Who it is for", before.forWhom ?? "—", after.forWhom ?? "—");
  compare("Seats", before.seats, after.seats);
  compare("Companies", before.companies, after.companies);
  compare("Storage (GB)", before.storageGb, after.storageGb);
  compare("Support", before.support, after.support);
  compare("Currency", before.currency, after.currency);
  compare("Modules", before.modules.join(", ") || "—", after.modules.join(", ") || "—");
  compare("Features", `${before.includes.length} bullets`, `${after.includes.length} bullets`);

  for (const cycle of BILLING_CYCLES) {
    const a = before.prices[cycle] ?? { cycleAmountCents: 0, monthlyEquivalentCents: 0 };
    const b = after.prices[cycle] ?? { cycleAmountCents: 0, monthlyEquivalentCents: 0 };
    if (a.monthlyEquivalentCents !== b.monthlyEquivalentCents) {
      rows.push({
        label: `${CYCLE_LABELS[cycle]} — per month`,
        before: formatMoney(a.monthlyEquivalentCents, { currency: before.currency }),
        after: formatMoney(b.monthlyEquivalentCents, { currency: after.currency }),
      });
    }
    if (a.cycleAmountCents !== b.cycleAmountCents) {
      rows.push({
        label: `${CYCLE_LABELS[cycle]} — billed`,
        before: formatMoney(a.cycleAmountCents, { currency: before.currency }),
        after: formatMoney(b.cycleAmountCents, { currency: after.currency }),
      });
    }
  }

  return rows;
}
