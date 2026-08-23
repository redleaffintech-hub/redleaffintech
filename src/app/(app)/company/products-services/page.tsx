import { db } from "@/lib/db";
import { contains } from "@/lib/search";
import { requireVisible } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { ITEM_TYPE_LABELS, ITEM_UNITS, itemUnitLabel, type ItemType } from "@/lib/enums";
import { Badge, Card, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { CatalogueRowActions, NewItemButton } from "./catalogue-client";

export const metadata = { title: "Products & services" };

export default async function ProductsServicesPage({
  searchParams,
}: {
  // Typed routes are generated at build time; this route is new, so the
  // params are typed directly until the next build regenerates them.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, role } = await requireVisible(CAPABILITIES.COMPANY_SETTINGS);
  const manage = can(role, CAPABILITIES.COMPANY_SETTINGS);
  const params = await searchParams;

  const filter = typeof params.filter === "string" ? params.filter : "";
  const query = typeof params.q === "string" ? params.q : "";

  const where = {
    companyId: company.id,
    ...(filter === "PRODUCT" || filter === "SERVICE" ? { type: filter } : {}),
    ...(filter === "ACTIVE" ? { isActive: true } : {}),
    ...(filter === "INACTIVE" ? { isActive: false } : {}),
    ...(query
      ? { OR: [{ code: contains(query) }, { name: contains(query) }, { description: contains(query) }] }
      : {}),
  };

  const [items, counts, accounts, taxCodes] = await Promise.all([
    db.serviceItem.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      include: {
        incomeAccount: { select: { code: true, name: true } },
        expenseAccount: { select: { code: true, name: true } },
        taxCode: { select: { code: true } },
        purchaseTaxCode: { select: { code: true } },
      },
    }),
    Promise.all([
      db.serviceItem.count({ where: { companyId: company.id } }),
      db.serviceItem.count({ where: { companyId: company.id, type: "PRODUCT" } }),
      db.serviceItem.count({ where: { companyId: company.id, type: "SERVICE" } }),
      db.serviceItem.count({ where: { companyId: company.id, isActive: true } }),
      db.serviceItem.count({ where: { companyId: company.id, isActive: false } }),
    ]),
    db.account.findMany({
      where: { companyId: company.id, isActive: true, type: { in: ["REVENUE", "EXPENSE", "ASSET"] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
    db.taxCode.findMany({
      where: { companyId: company.id, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  // How many documents reference each item. An item that has been used can be
  // archived but never deleted, and the table says so rather than letting
  // someone discover it only when the delete fails.
  const usage = await db.$transaction([
    db.invoiceLine.groupBy({ by: ["itemId"], where: { itemId: { not: null }, invoice: { companyId: company.id } }, _count: true, orderBy: { itemId: "asc" } }),
    db.estimateLine.groupBy({ by: ["itemId"], where: { itemId: { not: null }, estimate: { companyId: company.id } }, _count: true, orderBy: { itemId: "asc" } }),
    db.creditNoteLine.groupBy({ by: ["itemId"], where: { itemId: { not: null }, creditNote: { companyId: company.id } }, _count: true, orderBy: { itemId: "asc" } }),
    db.billLine.groupBy({ by: ["itemId"], where: { itemId: { not: null }, bill: { companyId: company.id } }, _count: true, orderBy: { itemId: "asc" } }),
  ]);
  const usedCount = new Map<string, number>();
  for (const group of usage) {
    for (const row of group) {
      if (!row.itemId) continue;
      const n = typeof row._count === "number" ? row._count : 0;
      usedCount.set(row.itemId, (usedCount.get(row.itemId) ?? 0) + n);
    }
  }

  const [total, products, services, active, inactive] = counts;
  const options = {
    incomeAccounts: accounts.filter((a) => a.type === "REVENUE"),
    expenseAccounts: accounts.filter((a) => a.type === "EXPENSE" || a.type === "ASSET"),
    taxCodes,
    units: [...ITEM_UNITS],
    currency: company.baseCurrency,
  };

  return (
    <>
      <PageHeader
        title="Products & services"
        breadcrumb={[{ label: "Company" }, { label: "Products & services" }]}
        description="Reusable lines for invoices, quotes, credit notes and bills. Everything here is a default — any document can still change it."
        actions={
          <>
            <ExportCsvButton report="products-services" />
            {manage && <NewItemButton options={options} />}
          </>
        }
      />

      <FilterBar
        paramName="filter"
        searchPlaceholder="Search by code, name or description…"
        tabs={[
          { label: "All", value: "", count: total },
          { label: "Products", value: "PRODUCT", count: products },
          { label: "Services", value: "SERVICE", count: services },
          { label: "Active", value: "ACTIVE", count: active },
          { label: "Inactive", value: "INACTIVE", count: inactive },
        ]}
      />

      <Card padded={false}>
        {items.length === 0 ? (
          <EmptyState
            title={query || filter ? "No matching items" : "No products or services yet"}
            description={
              query || filter
                ? "Nothing matches that search. Clear the filters to see the whole catalogue."
                : "Add the work you sell and the things you buy regularly, and every invoice, quote and bill can pull them in with one click."
            }
            action={manage && !query && !filter ? <NewItemButton options={options} /> : undefined}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="6rem">Code</Th>
                <Th>Name</Th>
                <Th width="5.5rem">Type</Th>
                <Th width="5rem">Unit</Th>
                <Th width="7rem" align="right">List price</Th>
                <Th width="5rem" align="right">Discount</Th>
                <Th>Accounts</Th>
                <Th width="5rem">Tax</Th>
                {manage && <Th width="3rem" align="right">{""}</Th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id} className={item.isActive ? undefined : "opacity-60"}>
                  <Td className="tnum font-medium text-ink-900">{item.code}</Td>
                  <Td>
                    <span className="font-medium text-ink-900">{item.name}</span>
                    {item.description && (
                      <span className="block text-[0.75rem] leading-5 text-muted-ink">{item.description}</span>
                    )}
                    {!item.isActive && <Badge className="mt-1">archived</Badge>}
                  </Td>
                  <Td>
                    <Badge tone={item.type === "PRODUCT" ? "accent" : "neutral"}>
                      {ITEM_TYPE_LABELS[item.type as ItemType] ?? item.type}
                    </Badge>
                  </Td>
                  <Td className="text-[0.8125rem] text-muted-ink">{itemUnitLabel(item.unit)}</Td>
                  <Td align="right">
                    <Money cents={item.unitPriceCents} currency={company.baseCurrency} showCurrency />
                  </Td>
                  <Td align="right" className="tnum text-[0.8125rem] text-muted-ink">
                    {item.discountPercentMicro > 0 ? `${item.discountPercentMicro / 1_000_000}%` : "—"}
                  </Td>
                  <Td className="text-[0.75rem] leading-5 text-muted-ink">
                    {item.incomeAccount && <span className="block">Sales: {item.incomeAccount.code} {item.incomeAccount.name}</span>}
                    {item.expenseAccount && <span className="block">Purchase: {item.expenseAccount.code} {item.expenseAccount.name}</span>}
                    {!item.incomeAccount && !item.expenseAccount && "—"}
                  </Td>
                  <Td className="text-[0.75rem] leading-5 text-muted-ink">
                    {item.taxCode && <span className="block">S: {item.taxCode.code}</span>}
                    {item.purchaseTaxCode && <span className="block">P: {item.purchaseTaxCode.code}</span>}
                    {!item.taxCode && !item.purchaseTaxCode && "—"}
                  </Td>
                  {manage && (
                    <Td align="right">
                      <CatalogueRowActions
                        item={{
                          id: item.id,
                          type: item.type,
                          code: item.code,
                          name: item.name,
                          description: item.description ?? "",
                          unit: item.unit,
                          unitPriceCents: item.unitPriceCents,
                          discountPercentMicro: item.discountPercentMicro,
                          incomeAccountId: item.incomeAccountId ?? "",
                          expenseAccountId: item.expenseAccountId ?? "",
                          taxCodeId: item.taxCodeId ?? "",
                          purchaseTaxCodeId: item.purchaseTaxCodeId ?? "",
                          isActive: item.isActive,
                        }}
                        options={options}
                        usedOnDocuments={usedCount.get(item.id) ?? 0}
                      />
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
