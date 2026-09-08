"use client";

import { useRouter } from "next/navigation";
import {
  VendorForm,
  type VendorFormTaxCode,
  type VendorFormValues,
} from "@/components/vendor-form";

/** Page wrapper: on save go back to the vendor's detail page. */
export function VendorEdit({
  vendor,
  taxCodes,
  defaultTermsDays,
}: {
  vendor: VendorFormValues;
  taxCodes: VendorFormTaxCode[];
  defaultTermsDays: number;
}) {
  const router = useRouter();
  return (
    <VendorForm
      vendor={vendor}
      taxCodes={taxCodes}
      defaultTermsDays={defaultTermsDays}
      onSaved={() => {
        router.push(`/purchases/vendors/${vendor.id}`);
        router.refresh();
      }}
      onCancel={() => router.push(`/purchases/vendors/${vendor.id}`)}
    />
  );
}
