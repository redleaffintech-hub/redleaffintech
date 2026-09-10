import { listTaxCodes } from "@/server/db/tax-codes";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { VendorCreate } from "./vendor-create";

export const metadata = { title: "New vendor" };

export default async function NewVendorPage() {
  const { company } = await requireCapability(CAPABILITIES.BILLS);

  const taxCodes = (await listTaxCodes(company.id, { activeOnly: true }))
    .filter((c) => c.appliesToPurchases)
    .map((c) => ({ id: c.id, code: c.code, name: c.name }));

  return (
    <>
      <PageHeader
        title="New vendor"
        breadcrumb={[
          { label: "Purchases", href: "/purchases/bills" },
          { label: "Vendors", href: "/purchases/vendors" },
          { label: "New" },
        ]}
        description="Payment terms and the default tax code set here flow onto every bill raised for this vendor."
      />

      <Card className="max-w-4xl p-5">
        {/* 30 days matches Vendor.paymentTermsDays' own default — there is no
            company-level purchase default the way there is for sales. */}
        <VendorCreate taxCodes={taxCodes} defaultTermsDays={30} />
      </Card>
    </>
  );
}
