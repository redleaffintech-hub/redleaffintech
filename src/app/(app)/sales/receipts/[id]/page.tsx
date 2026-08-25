import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PaymentDetailPage } from "@/components/payment-detail";
import { applyReceiptAction, openInvoicesForCustomerAction, voidReceiptAction } from "../actions";

export const metadata = { title: "Receipt" };

export default async function ReceiptDetailPage({ params }: PageProps<"/sales/receipts/[id]">) {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  const { id } = await params;

  return PaymentDetailPage({
    companyId: company.id,
    companyName: company.name,
    currency: company.baseCurrency,
    type: "RECEIPT",
    paymentId: id,
    voidAction: voidReceiptAction,
    applyAction: applyReceiptAction,
    openDocumentsAction: openInvoicesForCustomerAction,
  });
}
