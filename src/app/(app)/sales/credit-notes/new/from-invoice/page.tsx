import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { invoiceReturnOptions } from "../../actions";
import { ReturnForm } from "./return-form";

export const metadata = { title: "Return goods from an invoice" };

export default async function NewReturnFromInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ invoiceId?: string }>;
}) {
  const { invoiceId } = await searchParams;
  if (!invoiceId) notFound();

  const options = await invoiceReturnOptions(invoiceId);
  if ("error" in options) notFound();

  return (
    <>
      <PageHeader
        title={`Return goods from invoice ${options.invoice.number}`}
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Credit notes", href: "/sales/credit-notes" },
          { label: "New return" },
        ]}
        description={
          `For ${options.invoice.customer.name} — a paid invoice can still be a valid return source; ` +
          "the credit created here is not automatically applied to any balance."
        }
      />
      <Card className="max-w-3xl p-5">
        <ReturnForm
          invoiceId={options.invoice.id}
          invoiceNumber={options.invoice.number}
          lines={options.lines}
        />
      </Card>
    </>
  );
}
