import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { DocumentForm } from "@/components/document-form";
import { billFormOptions, createBillAction } from "../actions";

export const metadata = { title: "New bill" };

export default async function NewBillPage() {
  await requireCapability(CAPABILITIES.BILLS);
  const { vendors, accounts, taxCodes, items, company } = await billFormOptions();

  return (
    <>
      <PageHeader
        title="New bill"
        breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: "Bills", href: "/purchases/bills" }, { label: "New" }]}
        description="Recoverable GST/HST is split out as an input tax credit; non-recoverable PST stays with the expense. The journal preview shows exactly where each part lands."
      />

      {vendors.length === 0 ? (
        <EmptyState
          title="Add a vendor first"
          description="A bill needs a vendor so the payable can be tracked and the statement produced."
          action={<LinkButton href="/purchases/vendors" variant="primary">Vendors</LinkButton>}
        />
      ) : (
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
        />
      )}
    </>
  );
}
