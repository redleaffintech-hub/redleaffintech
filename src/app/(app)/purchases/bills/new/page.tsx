import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { DocumentForm } from "@/components/document-form";
import { billFormOptions, createBillAction } from "../actions";

export const metadata = { title: "New bill" };

export default async function NewBillPage() {
  await requireCapability(CAPABILITIES.BILLS);
  const { vendors, accounts, taxCodes, items, purchaseTaxCodes } = await billFormOptions();

  return (
    <>
      <PageHeader
        title="New bill"
        breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: "Bills", href: "/purchases/bills" }, { label: "New" }]}
        description="Recoverable GST/HST is split out as an input tax credit; non-recoverable PST stays with the expense. The journal preview shows exactly where each part lands."
      />

      <DocumentForm
        kind="BILL"
        parties={vendors}
        accounts={accounts}
        taxCodes={taxCodes}
        items={items}
        defaultTaxInclusive={false}
        defaultTermsDays={30}
        onSubmitAction={createBillAction}
        cancelHref="/purchases/bills"
        vendorCreation={{ taxCodes: purchaseTaxCodes, defaultTermsDays: 30 }}
      />
    </>
  );
}
