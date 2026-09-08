import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Callout, PageHeader } from "@/components/ui";
import { DocumentForm } from "@/components/document-form";
import { invoiceFormOptions } from "../../invoices/actions";
import { createCustomerCreditNoteAction } from "../actions";

export const metadata = { title: "New credit note" };

export default async function NewCreditNotePage() {
  await requireCapability(CAPABILITIES.INVOICES);
  const options = await invoiceFormOptions();

  return (
    <>
      <PageHeader
        title="New credit note"
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Credit notes", href: "/sales/credit-notes" },
          { label: "New" },
        ]}
        description="A credit note reverses revenue and the tax that went with it, rather than editing the original invoice. It posts as soon as you save, then sits against the customer until it is applied."
      />

      <div className="mb-4">
        <Callout tone="caution" title="This posts immediately">
          There is no draft state. Saving writes the journal that reduces revenue, reverses the tax and brings the
          receivable down, and the credit is then available to apply against any open invoice for this customer.
        </Callout>
      </div>

      <DocumentForm
        kind="CREDIT_NOTE"
        parties={options.customers}
        accounts={options.accounts}
        taxCodes={options.taxCodes}
        items={options.items}
        defaultTaxInclusive={options.company.defaultTaxInclusive}
        defaultTermsDays={0}
        onSubmitAction={createCustomerCreditNoteAction}
        cancelHref="/sales/credit-notes"
        companyProfile={options.profile}
        companyProvince={options.company.province}
        customerCreation={{
          taxCodes: options.salesTaxCodes,
          defaultTermsDays: options.company.defaultPaymentTermsDays,
        }}
        provincesWithSalesTax={options.provincesWithSalesTax}
      />
    </>
  );
}
