import { listItems } from "@/server/db/items";
import { listAccounts } from "@/server/db/accounts";
import { listTaxCodes } from "@/server/db/tax-codes";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { estimates as estimatesRepo } from "@/server/db/estimates";
import { creditNotes as creditNotesRepo } from "@/server/db/credit-notes";
import { bills as billsRepo } from "@/server/db/bills";
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

  const q = query.toLowerCase();

  const [allItems, allAccounts, allTaxCodes, invoiceDocs, estimateDocs, creditNoteDocs, billDocs] =
    await Promise.all([
      listItems(company.id),
      listAccounts(company.id),
      listTaxCodes(company.id, { activeOnly: true }),
      invoicesRepo.list(company.id),
      estimatesRepo.list(company.id),
      creditNotesRepo.list(company.id),
      billsRepo.list(company.id),
    ]);
  const accountById = new Map(allAccounts.map((a) => [a.id, a]));
  const taxCodeById = new Map(allTaxCodes.map((c) => [c.id, c]));

  const total = allItems.length;
  const products = allItems.filter((i) => i.type === "PRODUCT").length;
  const services = allItems.filter((i) => i.type === "SERVICE").length;
  const active = allItems.filter((i) => i.isActive).length;
  const inactive = allItems.filter((i) => !i.isActive).length;

  const items = allItems
    .filter((i) => {
      if (filter === "PRODUCT" || filter === "SERVICE") return i.type === filter;
      if (filter === "ACTIVE") return i.isActive;
      if (filter === "INACTIVE") return !i.isActive;
      return true;
    })
    .filter(
      (i) =>
        !q ||
        i.code.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        (i.description ?? "").toLowerCase().includes(q),
    )
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.code.localeCompare(b.code))
    .map((i) => ({
      ...i,
      incomeAccount: i.incomeAccountId ? accountById.get(i.incomeAccountId) ?? null : null,
      expenseAccount: i.expenseAccountId ? accountById.get(i.expenseAccountId) ?? null : null,
      taxCode: i.taxCodeId ? taxCodeById.get(i.taxCodeId) ?? null : null,
      purchaseTaxCode: i.purchaseTaxCodeId ? taxCodeById.get(i.purchaseTaxCodeId) ?? null : null,
    }));

  // How many documents reference each item. An item that has been used can be
  // archived but never deleted, and the table says so rather than letting
  // someone discover it only when the delete fails.
  const usedCount = new Map<string, number>();
  for (const docs of [invoiceDocs, estimateDocs, creditNoteDocs, billDocs]) {
    for (const d of docs) {
      for (const line of d.lines ?? []) {
        if (!line.itemId) continue;
        usedCount.set(line.itemId, (usedCount.get(line.itemId) ?? 0) + 1);
      }
    }
  }

  const accounts = allAccounts
    .filter((a) => a.isActive && ["REVENUE", "EXPENSE", "ASSET"].includes(a.type))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type }));
  const options = {
    incomeAccounts: accounts.filter((a) => a.type === "REVENUE"),
    expenseAccounts: accounts.filter((a) => a.type === "EXPENSE" || a.type === "ASSET"),
    taxCodes: allTaxCodes.map((c) => ({ id: c.id, code: c.code, name: c.name })),
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
                <Th width="8rem" align="right">Stock</Th>
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
                  <Td align="right" className="text-[0.75rem] text-muted-ink">
                    {item.trackInventory ? (
                      <>
                        <span className="tnum block text-ink-800">{(item.quantityOnHandMilli / 1000).toLocaleString("en-CA")}</span>
                        <Money cents={Math.round((item.quantityOnHandMilli * item.averageCostCents) / 1000)} currency={company.baseCurrency} className="block" />
                      </>
                    ) : (
                      "—"
                    )}
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
                          trackInventory: item.trackInventory,
                          quantityOnHandMilli: item.quantityOnHandMilli,
                          averageCostCents: item.averageCostCents,
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
