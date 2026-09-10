import { notFound, redirect } from "next/navigation";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { isoDate } from "@/lib/dates";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { getTaxCodesByIds } from "@/server/db/tax-codes";
import { listAllocationsForInvoice } from "@/server/db/payment-allocations";
import { PageHeader } from "@/components/ui";
import { DocumentForm, type DocumentFormInitial } from "@/components/document-form";
import { invoiceFormOptions, updateInvoiceAction } from "../../actions";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const { id } = await params;

  const invoice = await invoicesRepo.get(company.id, id);
  if (!invoice) notFound();
  const allocations = await listAllocationsForInvoice(company.id, invoice.id);
  const lines = [...invoice.lines].sort((a, b) => a.lineNo - b.lineNo);

  // Editable only while nothing is owed against it and it is not void — otherwise
  // the correct route is unapply-then-edit, or a credit note.
  if (invoice.status === "VOID" || allocations.length > 0 || invoice.amountPaidCents !== 0) {
    redirect(`/sales/invoices/${id}`);
  }

  const options = await invoiceFormOptions();

  // A line may point at a tax code that has since been deactivated; keep it
  // selectable so editing an old invoice cannot silently drop it.
  const missingCodeIds = [
    ...new Set(lines.map((l) => l.taxCodeId).filter((x): x is string => Boolean(x))),
  ].filter((codeId) => !options.taxCodes.some((c) => c.id === codeId));
  const extraCodes = missingCodeIds.length
    ? [...(await getTaxCodesByIds(company.id, missingCodeIds)).values()]
    : [];

  const hasShipTo = Boolean(invoice.shipToLine1 || invoice.shipToCity || invoice.shipToProvince);

  const initial: DocumentFormInitial = {
    partyId: invoice.customerId,
    number: invoice.number,
    issueDate: isoDate(invoice.issueDate),
    secondDate: isoDate(invoice.dueDate),
    taxInclusive: invoice.taxInclusive,
    memo: invoice.memo ?? "",
    reference: invoice.poNumber ?? "",
    billTo: {
      name: invoice.billToName ?? "",
      line1: invoice.billToLine1 ?? "",
      line2: invoice.billToLine2 ?? "",
      city: invoice.billToCity ?? "",
      province: invoice.billToProvince ?? "",
      postalCode: invoice.billToPostalCode ?? "",
    },
    shipTo: hasShipTo
      ? {
          name: invoice.shipToName ?? "",
          line1: invoice.shipToLine1 ?? "",
          line2: invoice.shipToLine2 ?? "",
          city: invoice.shipToCity ?? "",
          province: invoice.shipToProvince ?? "",
          postalCode: invoice.shipToPostalCode ?? "",
        }
      : null,
    lines: lines.map((line) => ({
      description: line.description,
      quantity: String(line.quantityMilli / 1000),
      unitPrice: (line.unitPriceCents / 100).toFixed(2),
      discount: line.discountPercentMicro ? String(line.discountPercentMicro / 1_000_000) : "",
      accountId: line.accountId,
      taxCodeId: line.taxCodeId ?? "",
      itemId: line.itemId,
    })),
    posted: Boolean(invoice.journalEntryId),
  };

  return (
    <>
      <PageHeader
        title={`Edit invoice ${invoice.number}`}
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Invoices", href: "/sales/invoices" },
          { label: invoice.number, href: `/sales/invoices/${invoice.id}` },
          { label: "Edit" },
        ]}
        description={
          initial.posted
            ? "Saving reverses the original journal entry and posts the corrected one under the same invoice number."
            : "This invoice is a draft — changes affect no report until it is posted."
        }
      />

      <DocumentForm
        kind="INVOICE"
        initial={initial}
        parties={options.customers}
        accounts={options.accounts}
        taxCodes={[...options.taxCodes, ...extraCodes]}
        items={options.items}
        defaultTaxInclusive={options.company.defaultTaxInclusive}
        defaultTermsDays={options.company.defaultPaymentTermsDays}
        onSubmitAction={updateInvoiceAction.bind(null, invoice.id)}
        cancelHref={`/sales/invoices/${invoice.id}`}
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
