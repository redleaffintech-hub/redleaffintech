import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { ImportCard } from "./import-card";

export const metadata = { title: "Opening balances" };

export default async function OpeningBalancesPage() {
  await requireCapability(CAPABILITIES.COMPANY_SETTINGS);
  return (
    <>
      <PageHeader
        title="Opening balances"
        description="Upload what customers owe you (A/R) and what you owe vendors (A/P) on the day your books start. Each row creates the customer or vendor and posts its balance."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <ImportCard
          kind="CUSTOMER"
          title="A/R opening balances"
          subtitle="Customers and what they owe"
          templateHref="/company/opening-balances/template/ar"
          partyLabel="customer"
        />
        <ImportCard
          kind="VENDOR"
          title="A/P opening balances"
          subtitle="Vendors and what you owe"
          templateHref="/company/opening-balances/template/ap"
          partyLabel="vendor"
          note="Vendors have one address line, so Address Line 2 is saved in the vendor's notes."
        />
      </div>
      <p className="mt-4 text-sm text-neutral-600">
        The whole file is checked before anything is saved: if any row has a problem, nothing is imported and you will see which rows to fix.
        Names that already exist are rejected rather than duplicated.
      </p>
    </>
  );
}
