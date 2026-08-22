import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { CustomerCreate } from "./customer-create";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);

  const taxCodes = await db.taxCode.findMany({
    where: { companyId: company.id, isActive: true, appliesToSales: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  return (
    <>
      <PageHeader
        title="New customer"
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Customers", href: "/sales/customers" },
          { label: "New" },
        ]}
        description="Payment terms and the default tax code set here flow onto every invoice raised for this customer. The shipping province is what decides which sales tax applies."
      />

      <Card className="max-w-4xl p-5">
        <CustomerCreate taxCodes={taxCodes} defaultTermsDays={company.defaultPaymentTermsDays} />
      </Card>
    </>
  );
}
