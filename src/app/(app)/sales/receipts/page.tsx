import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PaymentListPage } from "@/components/payment-list";
import { voidReceiptAction } from "./actions";

export const metadata = { title: "Receipts" };

export default async function ReceiptsPage({ searchParams }: PageProps<"/sales/receipts">) {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  return PaymentListPage({
    companyId: company.id,
    companyName: company.name,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    currency: company.baseCurrency,
    type: "RECEIPT",
    searchParams: await searchParams,
    voidAction: voidReceiptAction,
  });
}
