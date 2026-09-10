import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { peekSequence } from "@/server/db/companies";
import { PageHeader } from "@/components/ui";
import { DocumentForm } from "@/components/document-form";
import { createInvoiceAction, invoiceFormOptions } from "../actions";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const options = await invoiceFormOptions();
  const suggestedNumber = await peekSequence(company.id, "invoice");

  return (
    <>
      <PageHeader
        title="New invoice"
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Invoices", href: "/sales/invoices" },
          { label: "New" },
        ]}
        description="Tax is calculated from the code in force on the invoice date, for the province the invoice ships to. The journal preview on the right is produced by the same engine that will post it."
      />

      <DocumentForm
        kind="INVOICE"
        parties={options.customers}
        accounts={options.accounts}
        taxCodes={options.taxCodes}
        items={options.items}
        defaultTaxInclusive={options.company.defaultTaxInclusive}
        defaultTermsDays={options.company.defaultPaymentTermsDays}
        onSubmitAction={createInvoiceAction}
        cancelHref="/sales/invoices"
        suggestedNumber={suggestedNumber}
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
