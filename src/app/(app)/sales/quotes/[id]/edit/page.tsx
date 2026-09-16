import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { isoDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { DocumentForm, type DocumentFormInitial } from "@/components/document-form";
import { invoiceFormOptions } from "../../../invoices/actions";
import { updateQuoteAction } from "../../actions";

export const metadata = { title: "Edit sales quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const { id } = await params;

  const quote = await db.estimate.findFirst({
    where: { id, companyId: company.id },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!quote) notFound();

  // A converted quote's invoice is the durable record from that point on
  // (issue 11) — editing here must not silently change it.
  if (quote.status === "CONVERTED") redirect(`/sales/quotes/${id}`);

  const options = await invoiceFormOptions();

  const missingCodeIds = [
    ...new Set(quote.lines.map((l) => l.taxCodeId).filter((x): x is string => Boolean(x))),
  ].filter((codeId) => !options.taxCodes.some((c) => c.id === codeId));
  const extraCodes = missingCodeIds.length
    ? await db.taxCode.findMany({
        where: { id: { in: missingCodeIds }, companyId: company.id },
        include: { components: true },
      })
    : [];

  const hasShipTo = Boolean(quote.shipToLine1 || quote.shipToCity || quote.shipToProvince);

  const initial: DocumentFormInitial = {
    partyId: quote.customerId,
    number: quote.number,
    issueDate: isoDate(quote.issueDate),
    secondDate: quote.expiryDate ? isoDate(quote.expiryDate) : isoDate(quote.issueDate),
    taxInclusive: quote.taxInclusive,
    memo: quote.memo ?? "",
    reference: quote.terms ?? "",
    billTo: {
      name: quote.billToName ?? "",
      line1: quote.billToLine1 ?? "",
      line2: quote.billToLine2 ?? "",
      city: quote.billToCity ?? "",
      province: quote.billToProvince ?? "",
      postalCode: quote.billToPostalCode ?? "",
    },
    shipTo: hasShipTo
      ? {
          name: quote.shipToName ?? "",
          line1: quote.shipToLine1 ?? "",
          line2: quote.shipToLine2 ?? "",
          city: quote.shipToCity ?? "",
          province: quote.shipToProvince ?? "",
          postalCode: quote.shipToPostalCode ?? "",
        }
      : null,
    lines: quote.lines.map((line) => ({
      description: line.description,
      quantity: String(line.quantityMilli / 1000),
      unitPrice: (line.unitPriceCents / 100).toFixed(2),
      discountMode: line.discountMode as "PERCENT" | "FIXED",
      discount: line.discountPercentMicro ? String(line.discountPercentMicro / 1_000_000) : "",
      discountAmount: line.discountAmountCents ? (line.discountAmountCents / 100).toFixed(2) : "",
      accountId: line.accountId,
      taxCodeId: line.taxCodeId ?? "",
      itemId: line.itemId,
    })),
    // A quote never posts either way, so this flag is irrelevant to it — the
    // shared editor only reads it to decide an invoice/bill's draft option.
    posted: false,
  };

  return (
    <>
      <PageHeader
        title={`Edit quote ${quote.number}`}
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Sales quotes", href: "/sales/quotes" },
          { label: quote.number, href: `/sales/quotes/${quote.id}` },
          { label: "Edit" },
        ]}
        description="Editing a quote changes no account balance — it never posted anything to begin with."
      />

      <DocumentForm
        kind="QUOTE"
        initial={initial}
        parties={options.customers}
        accounts={options.accounts}
        taxCodes={[...options.taxCodes, ...extraCodes]}
        items={options.items}
        defaultTaxInclusive={options.company.defaultTaxInclusive}
        defaultTermsDays={options.company.defaultPaymentTermsDays}
        onSubmitAction={updateQuoteAction.bind(null, quote.id)}
        cancelHref={`/sales/quotes/${quote.id}`}
        companyProfile={options.profile}
        companyProvince={options.company.province}
        companyTaxPolicy={options.taxPolicy}
        customerCreation={{
          taxCodes: options.salesTaxCodes,
          defaultTermsDays: options.company.defaultPaymentTermsDays,
        }}
        provincesWithSalesTax={options.provincesWithSalesTax}
        footerText={quote.footerText}
      />
    </>
  );
}
