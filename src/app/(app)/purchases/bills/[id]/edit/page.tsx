import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { isoDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { DocumentForm, type DocumentFormInitial } from "@/components/document-form";
import { billFormOptions, updateBillAction } from "../../actions";

export const metadata = { title: "Edit bill" };

export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.BILLS);
  const { id } = await params;

  const bill = await db.bill.findFirst({
    where: { id, companyId: company.id },
    include: { lines: { orderBy: { lineNo: "asc" } }, allocations: { select: { id: true } } },
  });
  if (!bill) notFound();

  // Editable only while nothing is owed against it and it is not void.
  if (bill.status === "VOID" || bill.allocations.length > 0 || bill.amountPaidCents !== 0) {
    redirect(`/purchases/bills/${id}`);
  }

  const options = await billFormOptions();

  const missingCodeIds = [
    ...new Set(bill.lines.map((l) => l.taxCodeId).filter((x): x is string => Boolean(x))),
  ].filter((codeId) => !options.taxCodes.some((c) => c.id === codeId));
  const extraCodes = missingCodeIds.length
    ? await db.taxCode.findMany({
        where: { id: { in: missingCodeIds }, companyId: company.id },
        include: { components: true },
      })
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
    lines: bill.lines.map((line) => ({
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
