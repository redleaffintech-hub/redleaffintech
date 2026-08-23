import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminPageHeader } from "@/components/admin/ui";
import { RateForm } from "../rate-form";

export const metadata = { title: "New regional tax rate" };

export default async function NewRegionalTaxRatePage() {
  const actor = await requirePlatformAdmin();

  return (
    <>
      <AdminPageHeader
        title="Add a regional tax rate"
        description="Schedules a future regime for one province. It has no effect on any company until its effective date arrives, and even then it only changes what a NEW tax code is seeded with — nothing already posted is touched."
        breadcrumb={[{ label: "Regional tax rates", href: "/admin/regional-tax-rates" }, { label: "New" }]}
      />
      <RateForm csrfToken={actor.csrfToken} />
    </>
  );
}
