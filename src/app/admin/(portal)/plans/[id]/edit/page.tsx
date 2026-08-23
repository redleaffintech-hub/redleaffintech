import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { getPlanForAdmin } from "@/server/plans/admin";
import { planShapeFromRow } from "@/server/plans/catalogue";
import { BILLING_CYCLES } from "@/lib/plans";
import { AdminPageHeader } from "@/components/admin/ui";
import { PlanForm, type PlanFormValues } from "../../plan-form";
import type { AdminParams } from "@/lib/admin-constants";

export const metadata = { title: "Edit plan" };

export default async function EditPlanPage({ params }: { params: AdminParams<"id"> }) {
  const actor = await requirePlatformAdmin();
  const { id } = await params;

  const plan = await getPlanForAdmin(id);
  if (!plan) notFound();

  // The working copy, not the published snapshot — editing starts from where the
  // last edit left off, which may be ahead of what visitors currently see.
  const shape = planShapeFromRow(plan);

  const initial: PlanFormValues = {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description ?? "",
    forWhom: plan.forWhom ?? "",
    currency: plan.currency,
    seats: plan.seats,
    companies: plan.companies,
    storageGb: plan.storageGb,
    support: plan.support,
    modules: shape.modules,
    features: shape.includes,
    isPopular: plan.isPopular,
    contactOnly: plan.contactOnly,
    isPublic: plan.isPublic,
    sortOrder: plan.sortOrder,
    prices: Object.fromEntries(
      BILLING_CYCLES.map((cycle) => [cycle, shape.prices[cycle]]),
    ) as PlanFormValues["prices"],
  };

  return (
    <>
      <AdminPageHeader
        title={`Edit ${plan.name}`}
        description="Changes are saved as a draft. Publish from the plan's page to make them public."
        breadcrumb={[
          { label: "Plans & pricing", href: "/admin/plans" },
          { label: plan.name, href: `/admin/plans/${plan.id}` },
          { label: "Edit" },
        ]}
      />
      <PlanForm csrfToken={actor.csrfToken} initial={initial} isReferenced={plan._count.subscriptions > 0} />
    </>
  );
}
