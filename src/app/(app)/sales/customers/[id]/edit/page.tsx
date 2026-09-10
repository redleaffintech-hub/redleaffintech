import { notFound } from "next/navigation";
import { getCustomer } from "@/server/db/customers";
import { listTaxCodes } from "@/server/db/tax-codes";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { CustomerEdit } from "../customer-edit";

export const metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const { id } = await params;

  const customer = await getCustomer(company.id, id);
  if (!customer) notFound();

  const taxCodes = (await listTaxCodes(company.id, { activeOnly: true }))
    .filter((c) => c.appliesToSales)
    .map((c) => ({ id: c.id, code: c.code, name: c.name }));

  return (
    <>
      <PageHeader
        title={`Edit ${customer.name}`}
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Customers", href: "/sales/customers" },
          { label: customer.name, href: `/sales/customers/${customer.id}` },
          { label: "Edit" },
        ]}
        description="Payment terms and the default tax code flow onto new invoices. Documents already issued keep the address snapshotted onto them."
      />

      <Card className="max-w-4xl p-5">
        <CustomerEdit
          taxCodes={taxCodes}
          defaultTermsDays={company.defaultPaymentTermsDays}
          customer={{
            id: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            taxCodeId: customer.taxCodeId,
            paymentTermsDays: customer.paymentTermsDays,
            addressLine1: customer.addressLine1,
            addressLine2: customer.addressLine2,
            city: customer.city,
            province: customer.province,
            postalCode: customer.postalCode,
            shipToLine1: customer.shipToLine1,
            shipToLine2: customer.shipToLine2,
            shipToCity: customer.shipToCity,
            shipToProvince: customer.shipToProvince,
            shipToPostalCode: customer.shipToPostalCode,
            notes: customer.notes,
          }}
        />
      </Card>
    </>
  );
}
