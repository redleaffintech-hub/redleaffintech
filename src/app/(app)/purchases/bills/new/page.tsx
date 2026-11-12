import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { DocumentForm } from "@/components/document-form";
import { billFormOptions, createBillAction } from "../actions";

export const metadata = { title: "New bill" };

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<{ costItem?: string }>;
}) {
  const { company: scoped } = await requireCapability(CAPABILITIES.BILLS);
  const { costItem } = await searchParams;
  const { vendors, accounts, taxCodes, items, purchaseTaxCodes, company, profile } = await billFormOptions();

  // "+ Add cost" on the Inventory page arrives here: a bill whose lines are capitalised onto one
  // inventory item and add no stock. Anything that is not a tracked item of this company is a 404.
  const costTarget = costItem
    ? await db.serviceItem.findFirst({
        where: { id: costItem, companyId: scoped.id, trackInventory: true },
        select: { id: true, code: true, name: true },
      })
    : null;
  if (costItem && !costTarget) notFound();

  return (
    <>
      <PageHeader
        title={costTarget ? "Add cost to inventory" : "New bill"}
        breadcrumb={
          costTarget
            ? [{ label: "Inventory", href: "/inventory" }, { label: costTarget.code, href: `/inventory/${costTarget.id}` }, { label: "Add cost" }]
            : [{ label: "Purchases", href: "/purchases/bills" }, { label: "Bills (AP Invoice)", href: "/purchases/bills" }, { label: "New" }]
        }
        description="Recoverable tax (GST/HST and PST/RST) is split out as an input tax credit; only components marked non-recoverable stay with the expense. The journal preview shows exactly where each part lands."
      />

      <DocumentForm
        kind="BILL"
        parties={vendors}
        accounts={accounts}
        taxCodes={taxCodes}
        items={items}
        defaultTaxInclusive={false}
        defaultTermsDays={30}
        onSubmitAction={createBillAction}
        cancelHref={costTarget ? `/inventory/${costTarget.id}` : "/purchases/bills"}
        companyProfile={profile}
        companyProvince={company.province}
        vendorCreation={{ taxCodes: purchaseTaxCodes, defaultTermsDays: 30 }}
        inventoryCost={costTarget ? { itemId: costTarget.id, itemName: `${costTarget.code} — ${costTarget.name}` } : undefined}
      />
    </>
  );
}
