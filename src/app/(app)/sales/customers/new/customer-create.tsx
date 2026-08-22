"use client";

import { useRouter } from "next/navigation";
import { CustomerForm, type CustomerFormTaxCode } from "@/components/customer-form";

/** Page wrapper: on success go to the new customer rather than back to the list. */
export function CustomerCreate({
  taxCodes,
  defaultTermsDays,
}: {
  taxCodes: CustomerFormTaxCode[];
  defaultTermsDays: number;
}) {
  const router = useRouter();
  return (
    <CustomerForm
      taxCodes={taxCodes}
      defaultTermsDays={defaultTermsDays}
      onCreated={(customer) => router.push(`/sales/customers/${customer.id}`)}
      onCancel={() => router.push("/sales/customers")}
    />
  );
}
