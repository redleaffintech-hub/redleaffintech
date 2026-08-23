import { requirePlatformAdmin } from "@/server/admin/guard";
import { sellablePlans } from "@/server/plans/catalogue";
import { PROVINCES } from "@/lib/enums";
import { currencyOptions } from "@/lib/currency";
import { AdminPageHeader } from "@/components/admin/ui";
import { NewClientForm } from "./client-form";

export const metadata = { title: "Create client" };

export default async function NewClientPage() {
  const actor = await requirePlatformAdmin();
  const plans = await sellablePlans();

  return (
    <>
      <AdminPageHeader
        title="Create client"
        description="Provision a company, its primary user and a subscription in one step."
        breadcrumb={[{ label: "Clients", href: "/admin/clients" }, { label: "New" }]}
      />
      <NewClientForm
        csrfToken={actor.csrfToken}
        plans={plans}
        provinces={PROVINCES}
        currencies={currencyOptions().map((option) => ({ code: option.code, label: option.label }))}
      />
    </>
  );
}
