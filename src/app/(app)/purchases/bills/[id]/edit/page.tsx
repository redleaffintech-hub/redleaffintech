import { notFound, redirect } from "next/navigation";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { isoDate } from "@/lib/dates";
import { bills as billsRepo } from "@/server/db/bills";
import { getTaxCodesByIds } from "@/server/db/tax-codes";
import { listAllocationsForBill } from "@/server/db/payment-allocations";
import { PageHeader } from "@/components/ui";
import { DocumentForm, type DocumentFormInitial } from "@/components/document-form";
import { billFormOptions, updateBillAction } from "../../actions";

export const metadata = { title: "Edit bill" };

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.BILLS);
  const { id } = await params;

  const bill = await billsRepo.get(company.id, id);
  if (!bill) notFound();
  const allocations = await listAllocationsForBill(company.id, bill.id);
  const lines = [...bill.lines].sort((a, b) => a.lineNo - b.lineNo);

  // Editable only while nothing is owed against it and it is not void.
  if (bill.status === "VOID" || allocations.length > 0 || bill.amountPaidCents !== 0) {
    redirect(`/purchases/bills/${id}`);
  }

  const options = await billFormOptions();

  const missingCodeIds = [
    ...new Set(lines.map((l) => l.taxCodeId).filter((x): x is string => Boolean(x))),
  ].filter((codeId) => !options.taxCodes.some((c) => c.id === codeId));
  const extraCodes = missingCodeIds.length
    ? [...(await getTaxCodesByIds(company.id, missingCodeIds)).values()]
    : [];

  const initial: DocumentFormInitial = {
    partyId: bill.vendorId,
    number: bill.number,
    issueDate: isoDate(bill.issueDate),
    secondDate: isoDate(bill.dueDate),
    taxInclusive: bill.taxInclusive,
    memo: bill.memo ?? "",
    reference: bill.vendorInvoiceNo ?? "",
    billTo: { name: "", line1: "", line2: "", city: "", province: "", postalCode: "" },
    shipTo: null,
    lines: lines.map((line) => ({
      description: line.description,
      quantity: String(line.quantityMilli / 1000),
      unitPrice: (line.unitPriceCents / 100).toFixed(2),
      discount: line.discountPercentMicro ? String(line.discountPercentMicro / 1_000_000) : "",
      accountId: line.accountId,
      taxCodeId: line.taxCodeId ?? "",
      itemId: line.itemId,
    })),
    posted: Boolean(bill.journalEntryId),
  };

  return (
    <>
      <PageHeader
        title={`Edit bill ${bill.number}`}
        breadcrumb={[
          { label: "Purchases", href: "/purchases/bills" },
          { label: "Bills", href: "/purchases/bills" },
          { label: bill.number, href: `/purchases/bills/${bill.id}` },
          { label: "Edit" },
        ]}
        description={
          initial.posted
            ? "Saving reverses the original journal entry and posts the corrected one under the same bill number."
            : "This bill has not been posted — changes affect no report until it is."
        }
      />

      <DocumentForm
        kind="BILL"
        initial={initial}
        parties={options.vendors}
        accounts={options.accounts}
        taxCodes={[...options.taxCodes, ...extraCodes]}
        items={options.items}
        defaultTaxInclusive={bill.taxInclusive}
        defaultTermsDays={30}
        onSubmitAction={updateBillAction.bind(null, bill.id)}
        cancelHref={`/purchases/bills/${bill.id}`}
        companyProfile={options.profile}
        companyProvince={options.company.province}
        vendorCreation={{ taxCodes: options.purchaseTaxCodes, defaultTermsDays: 30 }}
      />
    </>
  );
}
