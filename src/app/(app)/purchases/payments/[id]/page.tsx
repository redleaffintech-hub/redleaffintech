import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PaymentDetailPage } from "@/components/payment-detail";
import { applyPaymentAction, openBillsForVendorAction, voidPaymentAction } from "../actions";

export const metadata = { title: "Payment" };

export default async function VendorPaymentDetailPage({ params }: PageProps<"/purchases/payments/[id]">) {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  const { id } = await params;

  return PaymentDetailPage({
    companyId: company.id,
    companyName: company.name,
    currency: company.baseCurrency,
    type: "PAYMENT",
    paymentId: id,
    voidAction: voidPaymentAction,
    applyAction: applyPaymentAction,
    openDocumentsAction: openBillsForVendorAction,
  });
}
