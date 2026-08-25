"use client";

import { useRouter } from "next/navigation";
import { VendorForm, type VendorFormTaxCode } from "@/components/vendor-form";

/** Page wrapper: on success go to the new vendor rather than back to the list. */
export function VendorCreate({
  taxCodes,
  defaultTermsDays,
}: {
  taxCodes: VendorFormTaxCode[];
  defaultTermsDays: number;
}) {
  const router = useRouter();
  return (
    <VendorForm
      taxCodes={taxCodes}
      defaultTermsDays={defaultTermsDays}
      onCreated={(vendor) => router.push(`/purchases/vendors/${vendor.id}`)}
      onCancel={() => router.push("/purchases/vendors")}
    />
  );
}
