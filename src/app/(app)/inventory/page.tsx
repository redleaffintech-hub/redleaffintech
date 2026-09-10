import { listItems } from "@/server/db/items";
import { getSystemAccount } from "@/server/db/accounts";
import { listLinesUpTo } from "@/server/db/journal-entries";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { today } from "@/lib/dates";
import { Card, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { ReconciliationBanner } from "@/components/report-shell";
import { AdjustStockButton } from "./adjust-stock-dialog";
import { inventoryAdjustmentFormOptions } from "./actions";

export const metadata = { title: "Inventory" };

export default async function InventoryPage() {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);

  const [allItems, inventoryAsset, { accounts }] = await Promise.all([
    listItems(company.id),
    getSystemAccount(company.id, SYSTEM_ACCOUNTS.INVENTORY_ASSET),
    inventoryAdjustmentFormOptions(),
  ]);

  const items = allItems
    .filter((i) => i.trackInventory)
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.code.localeCompare(b.code));

  const rows = items.map((item) => ({
    ...item,
    valueCents: Math.round((item.quantityOnHandMilli * item.averageCostCents) / 1000),
  }));
  const totalValueCents = rows.reduce((s, r) => s + r.valueCents, 0);

  let glBalanceCents = 0;
  if (inventoryAsset) {
    const lines = (await listLinesUpTo(company.id, today())).filter(
      (l) => l.accountId === inventoryAsset.id,
    );
    glBalanceCents = lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
  }
  const differenceCents = totalValueCents - glBalanceCents;

  return (
    <>
      <PageHeader
        title="Inventory"
        breadcrumb={[{ label: "Inventory" }]}
        description="Stock on hand at weighted-average cost. A bill for a tracked item adds stock; an invoice sells it and posts cost of goods sold automatically."
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
            description={'Turn on "Track inventory" on a product in Products & services to start counting its stock here.'}
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
                <Th width="7rem" align="right">{""}</Th>
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
                    <AdjustStockButton itemId={item.id} itemName={`${item.code} — ${item.name}`} averageCostCents={item.averageCostCents} accounts={accounts} />
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
