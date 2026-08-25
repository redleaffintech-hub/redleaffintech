import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PaymentListPage } from "@/components/payment-list";
import { voidPaymentAction } from "./actions";

export const metadata = { title: "Payments" };

export default async function VendorPaymentsPage({ searchParams }: PageProps<"/purchases/payments">) {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  return PaymentListPage({
    companyId: company.id,
    companyName: company.name,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    currency: company.baseCurrency,
    type: "PAYMENT",
    searchParams: await searchParams,
    voidAction: voidPaymentAction,
  });
}
