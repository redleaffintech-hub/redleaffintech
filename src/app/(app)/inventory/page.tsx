import { db } from "@/lib/db";
import { requireVisible } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { SYSTEM_ACCOUNTS, ITEM_UNITS } from "@/lib/enums";
import { today } from "@/lib/dates";
import { Card, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { ReconciliationBanner } from "@/components/report-shell";
import { AdjustStockButton } from "./adjust-stock-dialog";
import { inventoryAdjustmentFormOptions } from "./actions";
import { itemUsageCounts } from "@/server/documents/item-usage";
import { CatalogueRowActions, NewItemButton, type CatalogueOptions } from "../company/products-services/catalogue-client";

export const metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const { company, role } = await requireVisible(CAPABILITIES.REPORTS);
  // Adding, editing and deleting a catalogue item is a company-settings
  // change (it's the same action products-services uses) — a role that can
  // only view reports still gets the read + adjust-stock view underneath.
  const manage = can(role, CAPABILITIES.COMPANY_SETTINGS);

  const [items, inventoryAsset, { accounts }, usage, glAccounts, taxCodes] = await Promise.all([
    db.serviceItem.findMany({
      where: { companyId: company.id, trackInventory: true },
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
    }),
    db.account.findFirst({ where: { companyId: company.id, systemKey: SYSTEM_ACCOUNTS.INVENTORY_ASSET } }),
    inventoryAdjustmentFormOptions(),
    manage ? itemUsageCounts(company.id) : Promise.resolve(new Map<string, number>()),
    manage
      ? db.account.findMany({
          where: { companyId: company.id, isActive: true, type: { in: ["REVENUE", "EXPENSE", "ASSET"] } },
          select: { id: true, code: true, name: true, type: true },
          orderBy: { code: "asc" },
        })
      : Promise.resolve([]),
    manage
      ? db.taxCode.findMany({
          where: { companyId: company.id, isActive: true },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const rows = items.map((item) => ({
    ...item,
    valueCents: Math.round((item.quantityOnHandMilli * item.averageCostCents) / 1000),
  }));
  const totalValueCents = rows.reduce((s, r) => s + r.valueCents, 0);

  let glBalanceCents = 0;
  if (inventoryAsset) {
    const movement = await db.journalLine.aggregate({
      where: { companyId: company.id, accountId: inventoryAsset.id, date: { lte: today() } },
      _sum: { debitCents: true, creditCents: true },
    });
    glBalanceCents = (movement._sum.debitCents ?? 0) - (movement._sum.creditCents ?? 0);
  }
  const differenceCents = totalValueCents - glBalanceCents;

  const catalogueOptions: CatalogueOptions = {
    incomeAccounts: glAccounts.filter((a) => a.type === "REVENUE"),
    expenseAccounts: glAccounts.filter((a) => a.type === "EXPENSE" || a.type === "ASSET"),
    taxCodes,
    units: [...ITEM_UNITS],
    currency: company.baseCurrency,
  };

  return (
    <>
      <PageHeader
        title="Inventory"
        breadcrumb={[{ label: "Inventory" }]}
        description="Stock on hand at weighted-average cost. A bill for a tracked item adds stock; an invoice sells it and posts cost of goods sold automatically."
        actions={
          manage ? (
            <NewItemButton
              options={catalogueOptions}
              initial={{ type: "PRODUCT", trackInventory: true, unit: "each" }}
              label="Add inventory item"
            />
          ) : undefined
        }
      />

      <ReconciliationBanner
        reconciled={differenceCents === 0}
        message={
          differenceCents === 0
            ? "Inventory value ties to the Inventory Asset control account."
            : `Inventory value is out by ${Math.abs(differenceCents / 100).toFixed(2)} against the Inventory Asset control account.`
        }
        detail={`Valuation ${(totalValueCents / 100).toFixed(2)} vs GL ${(glBalanceCents / 100).toFixed(2)}.`}
      />

      <Card padded={false}>
        {rows.length === 0 ? (
          <EmptyState
            title="No tracked items yet"
            description={
              manage
                ? 'Add an item here, or turn on "Track inventory" on an existing product in Products & services.'
                : 'Turn on "Track inventory" on a product in Products & services to start counting its stock here.'
            }
            action={
              manage ? (
                <NewItemButton
                  options={catalogueOptions}
                  initial={{ type: "PRODUCT", trackInventory: true, unit: "each" }}
                  label="Add inventory item"
                />
              ) : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="6rem">Code</Th>
                <Th>Name</Th>
                <Th width="8rem" align="right">On hand</Th>
                <Th width="8rem" align="right">Avg cost</Th>
                <Th width="8rem" align="right">Value</Th>
                <Th width={manage ? "14rem" : "7rem"} align="right">{""}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <Tr key={item.id} className={item.isActive ? undefined : "opacity-60"}>
                  <Td className="tnum font-medium text-ink-900">{item.code}</Td>
                  <Td>{item.name}</Td>
                  <Td align="right" className="tnum">
                    {(item.quantityOnHandMilli / 1000).toLocaleString("en-CA")} {item.unit}
                  </Td>
                  <Td align="right"><Money cents={item.averageCostCents} currency={company.baseCurrency} /></Td>
                  <Td align="right"><Money cents={item.valueCents} currency={company.baseCurrency} bold /></Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-1">
                      <AdjustStockButton itemId={item.id} itemName={`${item.code} — ${item.name}`} averageCostCents={item.averageCostCents} accounts={accounts} />
                      {manage && (
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
                          options={catalogueOptions}
                          usedOnDocuments={usage.get(item.id) ?? 0}
                        />
                      )}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={4} className="pt-3 font-medium text-ink-700">{rows.length} tracked item(s)</Td>
                <Td align="right" className="pt-3"><Money cents={totalValueCents} bold currency={company.baseCurrency} /></Td>
                <Td className="pt-3" />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
