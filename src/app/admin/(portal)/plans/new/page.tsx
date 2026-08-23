import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminPageHeader } from "@/components/admin/ui";
import { PlanForm } from "../plan-form";

export const metadata = { title: "New plan" };

export default async function NewPlanPage() {
  const actor = await requirePlatformAdmin();

  return (
    <>
      <AdminPageHeader
        title="New plan"
        description="Created as a draft. Nothing reaches the public pricing page until you publish it."
        breadcrumb={[{ label: "Plans & pricing", href: "/admin/plans" }, { label: "New" }]}
      />
      <PlanForm csrfToken={actor.csrfToken} />
    </>
  );
}
