import { db } from "@/lib/db";
import { contains } from "@/lib/search";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { PartyTable, type PartyRow } from "@/components/party-views";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/sales/customers">) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const filter = typeof params.status === "string" ? params.status : "";

  const customers = await db.customer.findMany({
    where: {
      companyId: company.id,
      ...(filter === "ACTIVE" ? { isActive: true } : filter === "ARCHIVED" ? { isActive: false } : {}),
      ...(query ? { OR: [{ name: contains(query) }, { email: contains(query) }] } : {}),
    },
    include: {
      taxCode: { select: { code: true } },
      invoices: { select: { totalCents: true, balanceCents: true, status: true } },
    },
    orderBy: { name: "asc" },
  });

  const rows: PartyRow[] = customers.map((customer) => ({
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    city: customer.city,
    province: customer.province,
    paymentTermsDays: customer.paymentTermsDays,
    isActive: customer.isActive,
    taxCodeLabel: customer.taxCode?.code ?? null,
    openDocuments: customer.invoices.filter((i) => i.balanceCents > 0).length,
    outstandingCents: customer.invoices.reduce((s, i) => s + i.balanceCents, 0),
    lifetimeCents: customer.invoices.filter((i) => i.status !== "VOID" && i.status !== "DRAFT").reduce((s, i) => s + i.totalCents, 0),
  }));

  return (
    <>
      <PageHeader
        title="Customers"
        breadcrumb={[{ label: "Sales", href: "/sales/invoices" }, { label: "Customers" }]}
        description="Each customer carries their own payment terms and default tax code, which flow onto every invoice you raise for them."
        actions={
          <LinkButton href="/sales/customers/new" variant="primary">
            <Icon name="plus" className="h-3.5 w-3.5" />
            New customer
          </LinkButton>
        }
      />

      <FilterBar
        searchPlaceholder="Search name or email…"
        tabs={[
          { label: "All", value: "" },
          { label: "Active", value: "ACTIVE", count: customers.filter((c) => c.isActive).length },
          { label: "Archived", value: "ARCHIVED", count: customers.filter((c) => !c.isActive).length },
        ]}
      />

      <Card className="p-5">
        <PartyTable rows={rows} hrefBase="/sales/customers" kind="customer" newHref="/sales/customers/new" />
      </Card>
    </>
  );
}
