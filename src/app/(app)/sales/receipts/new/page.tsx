import { PageHeader } from "@/components/ui";
import { PaymentForm } from "@/components/payment-form";
import { createReceiptAction, openInvoicesForCustomerAction, receiptFormOptions } from "../actions";

export const metadata = { title: "New receipt" };

export default async function NewReceiptPage() {
  const { customers, bankAccounts } = await receiptFormOptions();

  return (
    <>
      <PageHeader
        title="New receipt"
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Receipts", href: "/sales/receipts" },
          { label: "New" },
        ]}
        description="Record money received from a customer and apply it across as many open invoices as it covers."
      />

      <PaymentForm
        kind="RECEIPT"
        parties={customers}
        bankAccounts={bankAccounts}
        openDocumentsAction={openInvoicesForCustomerAction}
        submitAction={createReceiptAction}
        cancelHref="/sales/receipts"
      />
    </>
  );
}
