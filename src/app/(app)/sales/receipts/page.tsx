import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PaymentListPage } from "@/components/payment-list";

export const metadata = { title: "Receipts" };

export default async function ReceiptsPage({ searchParams }: PageProps<"/sales/receipts">) {
  const { company } = await requireCapability(CAPABILITIES.PAYMENTS);
  return PaymentListPage({
    companyId: company.id,
    companyName: company.name,
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    type: "RECEIPT",
    searchParams: await searchParams,
  });
}
