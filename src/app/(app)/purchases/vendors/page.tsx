import { listVendors } from "@/server/db/vendors";
import { listBillsForVendor } from "@/server/db/bills";
import { getTaxCodesByIds } from "@/server/db/tax-codes";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { PartyTable, type PartyRow } from "@/components/party-views";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Vendors" };

export default async function VendorsPage({ searchParams }: PageProps<"/purchases/vendors">) {
  const { company } = await requireCapability(CAPABILITIES.BILLS);
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const filter = typeof params.status === "string" ? params.status : "";

  const q = query.toLowerCase();
  const all = (await listVendors(company.id)).filter(
    (v) =>
      (filter === "ACTIVE" ? v.isActive : filter === "ARCHIVED" ? !v.isActive : true) &&
      (!q || v.name.toLowerCase().includes(q) || (v.email ?? "").toLowerCase().includes(q)),
  );
  const taxCodes = await getTaxCodesByIds(
    company.id,
    all.map((v) => v.taxCodeId).filter((id): id is string => Boolean(id)),
  );
  const vendors = await Promise.all(
    all.map(async (v) => ({
      ...v,
      taxCodeLabel: v.taxCodeId ? taxCodes.get(v.taxCodeId)?.code ?? null : null,
      bills: await listBillsForVendor(company.id, v.id),
    })),
  );

  const rows: PartyRow[] = vendors.map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    email: vendor.email,
    phone: vendor.phone,
    city: vendor.city,
    province: vendor.province,
    paymentTermsDays: vendor.paymentTermsDays,
    isActive: vendor.isActive,
    taxCodeLabel: vendor.taxCodeLabel,
    openDocuments: vendor.bills.filter((b) => b.balanceCents > 0).length,
    outstandingCents: vendor.bills.reduce((s, b) => s + b.balanceCents, 0),
    lifetimeCents: vendor.bills
      .filter((b) => b.status !== "VOID" && b.status !== "DRAFT")
      .reduce((s, b) => s + b.totalCents, 0),
  }));

  return (
    <>
      <PageHeader
        title="Vendors"
        breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: "Vendors" }]}
        description="Vendors carry their own payment terms and default tax code, and duplicate bill detection keys off their invoice numbers."
        actions={
          <LinkButton href="/purchases/vendors/new" variant="primary">
            <Icon name="plus" className="h-3.5 w-3.5" />
            New vendor
          </LinkButton>
        }
      />

      <FilterBar
        searchPlaceholder="Search name or email…"
        tabs={[
          { label: "All", value: "" },
          { label: "Active", value: "ACTIVE", count: vendors.filter((v) => v.isActive).length },
          { label: "Archived", value: "ARCHIVED", count: vendors.filter((v) => !v.isActive).length },
        ]}
      />

      <Card className="p-5">
        <PartyTable rows={rows} hrefBase="/purchases/vendors" kind="vendor" newHref="/purchases/vendors/new" />
      </Card>
    </>
  );
}
