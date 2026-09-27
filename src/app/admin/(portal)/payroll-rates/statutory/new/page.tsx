import { requirePlatformAdmin } from "@/server/admin/guard";
import { AdminPageHeader } from "@/components/admin/ui";
import { StatutoryRateForm } from "../rate-form";

export const metadata = { title: "New payroll statutory rate" };

export default async function NewStatutoryRatePage() {
  const actor = await requirePlatformAdmin();

  return (
    <>
      <AdminPageHeader
        title="Add a payroll statutory rate"
        description="Schedules a future year's CPP/CPP2/EI parameters. It has no effect until its effective date arrives, and even then only changes what a NEW pay-run calculation reads — nothing already posted is touched."
        breadcrumb={[{ label: "Payroll rates" }, { label: "Statutory (CPP/CPP2/EI)", href: "/admin/payroll-rates/statutory" }, { label: "New" }]}
      />
      <StatutoryRateForm csrfToken={actor.csrfToken} />
    </>
  );
}
