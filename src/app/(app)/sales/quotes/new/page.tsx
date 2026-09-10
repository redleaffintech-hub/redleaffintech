import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { peekSequence } from "@/server/db/companies";
import { DEFAULT_QUOTE_VALIDITY_DAYS } from "@/server/documents/estimates-fs";
import { PageHeader } from "@/components/ui";
import { DocumentForm } from "@/components/document-form";
import { invoiceFormOptions } from "../../invoices/actions";
import { createQuoteAction } from "../actions";

export const metadata = { title: "New sales quote" };

export default async function NewQuotePage() {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const options = await invoiceFormOptions();
  const suggestedNumber = await peekSequence(company.id, "estimate");

  return (
    <>
      <PageHeader
        title="New sales quote"
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Sales quotes", href: "/sales/quotes" },
          { label: "New" },
        ]}
        description="A quote is priced with the same tax engine an invoice uses, so the total the customer accepts is the total they will be billed. Nothing is posted to the ledger until it becomes an invoice."
      />

      <DocumentForm
        kind="QUOTE"
        parties={options.customers}
        accounts={options.accounts}
        taxCodes={options.taxCodes}
        items={options.items}
        defaultTaxInclusive={options.company.defaultTaxInclusive}
        // The second date on a quote is how long it stands for, not payment terms.
        defaultTermsDays={DEFAULT_QUOTE_VALIDITY_DAYS}
        onSubmitAction={createQuoteAction}
        cancelHref="/sales/quotes"
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
