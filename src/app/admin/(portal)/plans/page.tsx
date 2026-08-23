import Link from "next/link";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { listPlansForAdmin } from "@/server/plans/admin";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { BILLING_CYCLES, CYCLE_LABELS, PLAN_STATUS_LABELS, type PlanStatus } from "@/lib/plans";
import { Badge, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, EmptyRow } from "@/components/admin/ui";
import { PlanRowActions } from "./row-actions";
import { ReorderForm } from "./reorder-form";

export const metadata = { title: "Plans & pricing" };

const STATUS_TONE: Record<PlanStatus, "neutral" | "positive" | "info"> = {
  DRAFT: "info",
  PUBLISHED: "positive",
  ARCHIVED: "neutral",
};

/**
 * The catalogue.
 *
 * The column that matters most is "unpublished changes": it is the difference
 * between what an administrator has typed and what the world can see. A plan can
 * sit in that state indefinitely without any visitor noticing, which is exactly
 * what makes revising a price safe.
 */
export default async function PlansPage() {
  const actor = await requirePlatformAdmin();
  const plans = await listPlansForAdmin();

  const live = plans.filter((plan) => plan.status === "PUBLISHED" && plan.isPublic && !plan.archivedAt);
  const drafts = plans.filter((plan) => plan.status === "DRAFT" || plan.hasDraftChanges);

  return (
    <>
      <AdminPageHeader
        title="Plans & pricing"
        description="The catalogue the public pricing page sells, the in-app plan picker offers, and every seat check enforces."
        actions={
          <>
            <Link
              href="/pricing"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
            >
              View public page
            </Link>
            <Link
              href="/admin/plans/new"
              className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
            >
              New plan
            </Link>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Live on the public page" value={live.length} />
        <SummaryTile label="With unpublished changes" value={drafts.length} />
        <SummaryTile
          label="Subscriptions on a plan"
          value={plans.reduce((sum, plan) => sum + plan._count.subscriptions, 0)}
        />
      </div>

      <AdminCard className="mb-5">
        <Table>
          <thead>
            <tr>
              <Th width="4rem">Order</Th>
              <Th>Plan</Th>
              <Th>Status</Th>
              {BILLING_CYCLES.map((cycle) => (
                <Th key={cycle} align="right">
                  {CYCLE_LABELS[cycle]}
                </Th>
              ))}
              <Th align="right">Seats</Th>
              <Th align="right">Subs</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 ? (
              <EmptyRow colSpan={9}>
                No plans yet. Seed the founding catalogue with{" "}
                <code className="font-mono text-[0.75rem]">npm run plans:seed</code>, or{" "}
                <Link href="/admin/plans/new" className="font-medium text-brand-700 hover:underline">
                  create one
                </Link>
                .
              </EmptyRow>
            ) : (
              plans.map((plan) => (
                <Tr key={plan.id} className={plan.archivedAt ? "opacity-60" : undefined}>
                  <Td className="tabular-nums text-muted-ink">{plan.sortOrder}</Td>
                  <Td>
                    <Link
                      href={`/admin/plans/${plan.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                    >
                      {plan.name}
                    </Link>
                    <span className="block font-mono text-[0.6875rem] text-muted-ink">{plan.code}</span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <Badge tone={STATUS_TONE[plan.status as PlanStatus] ?? "neutral"}>
                        {PLAN_STATUS_LABELS[plan.status as PlanStatus] ?? plan.status}
                      </Badge>
                      {plan.hasDraftChanges && plan.status === "PUBLISHED" && (
                        <Badge tone="caution">unpublished edits</Badge>
                      )}
                      {!plan.isPublic && !plan.archivedAt && <Badge tone="neutral">private</Badge>}
                      {plan.isPopular && <Badge tone="accent">popular</Badge>}
                    </span>
                    {plan.publishedAt && (
                      <span className="mt-0.5 block text-[0.6875rem] text-muted-ink">
                        published {formatDate(plan.publishedAt)}
                      </span>
                    )}
                  </Td>
                  {BILLING_CYCLES.map((cycle) => {
                    const price = plan.prices.find((row) => row.cycle === cycle);
                    return (
                      <Td key={cycle} align="right">
                        {price ? (
                          <span className="tabular-nums">
                            {formatMoney(price.monthlyEquivalentCents, { currency: plan.currency }).replace(
                              /\.00$/,
                              "",
                            )}
                            <span className="block text-[0.6875rem] text-muted-ink">
                              {formatMoney(price.cycleAmountCents, { currency: plan.currency }).replace(/\.00$/, "")}{" "}
                              billed
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-ink">—</span>
                        )}
                      </Td>
                    );
                  })}
                  <Td align="right" className="tabular-nums">
                    {plan.seats}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {plan._count.subscriptions}
                  </Td>
                  <Td align="right">
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
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </AdminCard>

      {plans.length > 1 && (
        <ReorderForm
          csrfToken={actor.csrfToken}
          plans={plans.map((plan) => ({ id: plan.id, name: plan.name, sortOrder: plan.sortOrder }))}
        />
      )}
    </>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-(--radius-card) border border-paper-300 bg-white p-4">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className="tnum mt-1.5 font-display text-[1.5rem] font-semibold leading-none text-ink-950">{value}</p>
    </div>
  );
}
