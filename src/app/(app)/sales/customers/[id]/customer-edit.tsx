"use client";

import { useRouter } from "next/navigation";
import {
  CustomerForm,
  type CustomerFormTaxCode,
  type CustomerFormValues,
} from "@/components/customer-form";

/** Page wrapper: on save go back to the customer's detail page. */
export function CustomerEdit({
  customer,
  taxCodes,
  defaultTermsDays,
}: {
  customer: CustomerFormValues;
  taxCodes: CustomerFormTaxCode[];
  defaultTermsDays: number;
}) {
  const router = useRouter();
  return (
    <CustomerForm
      customer={customer}
      taxCodes={taxCodes}
      defaultTermsDays={defaultTermsDays}
      onSaved={() => {
        router.push(`/sales/customers/${customer.id}`);
        router.refresh();
      }}
      onCancel={() => router.push(`/sales/customers/${customer.id}`)}
    />
  );
}
