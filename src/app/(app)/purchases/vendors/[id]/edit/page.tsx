import { notFound } from "next/navigation";
import { getVendor } from "@/server/db/vendors";
import { listTaxCodes } from "@/server/db/tax-codes";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { VendorEdit } from "../vendor-edit";

export const metadata = { title: "Edit vendor" };

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.BILLS);
  const { id } = await params;

  const vendor = await getVendor(company.id, id);
  if (!vendor) notFound();

  const taxCodes = (await listTaxCodes(company.id, { activeOnly: true }))
    .filter((c) => c.appliesToPurchases)
    .map((c) => ({ id: c.id, code: c.code, name: c.name }));

  return (
    <>
      <PageHeader
        title={`Edit ${vendor.name}`}
        breadcrumb={[
          { label: "Purchases", href: "/purchases/bills" },
          { label: "Vendors", href: "/purchases/vendors" },
          { label: vendor.name, href: `/purchases/vendors/${vendor.id}` },
          { label: "Edit" },
        ]}
        description="Payment terms and the default tax code flow onto new bills. Bills already recorded are unchanged."
      />

      <Card className="max-w-4xl p-5">
        <VendorEdit
          taxCodes={taxCodes}
          defaultTermsDays={30}
          vendor={{
            id: vendor.id,
            name: vendor.name,
            email: vendor.email,
            phone: vendor.phone,
            businessNumber: vendor.businessNumber,
            taxCodeId: vendor.taxCodeId,
            paymentTermsDays: vendor.paymentTermsDays,
            addressLine1: vendor.addressLine1,
            city: vendor.city,
            province: vendor.province,
            postalCode: vendor.postalCode,
            notes: vendor.notes,
          }}
        />
      </Card>
    </>
  );
}
