import { PageHeader } from "@/components/ui";
import { PaymentForm } from "@/components/payment-form";
import { createPaymentAction, openBillsForVendorAction, paymentFormOptions } from "../actions";

export const metadata = { title: "New payment" };

export default async function NewPaymentPage() {
  const { vendors, bankAccounts } = await paymentFormOptions();

  return (
    <>
      <PageHeader
        title="New payment"
        breadcrumb={[
          { label: "Purchases", href: "/purchases/bills" },
          { label: "Payments", href: "/purchases/payments" },
          { label: "New" },
        ]}
        description="Record money paid to a vendor and apply it across as many open bills as it covers."
      />

      <PaymentForm
        kind="PAYMENT"
        parties={vendors}
        bankAccounts={bankAccounts}
        openDocumentsAction={openBillsForVendorAction}
        submitAction={createPaymentAction}
        cancelHref="/purchases/payments"
      />
    </>
  );
}
