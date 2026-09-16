import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireVisible } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, dateRangeWhere } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { Card, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { DateRangeFilter } from "@/components/filter-bar";

export const metadata = { title: "Product history" };

const PAGE_SIZE = 50;

const TYPE_LABELS: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  SALE_RETURN: "Sales return",
  PURCHASE_RETURN: "Purchase return",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

const SOURCE_HREF: Record<string, (id: string) => string> = {
  INVOICE: (id) => `/sales/invoices/${id}`,
  BILL: (id) => `/purchases/bills/${id}`,
  CREDIT_NOTE: (id) => `/sales/credit-notes/${id}`,
};

export default async function InventoryItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const { company } = await requireVisible(CAPABILITIES.REPORTS);
  const currency = company.baseCurrency;
  const { id } = await params;
  const search = await searchParams;

  const item = await db.serviceItem.findFirst({ where: { id, companyId: company.id } });
  if (!item) notFound();

  const dateFilter = dateRangeWhere(search.from, search.to);
  const page = Math.max(1, Number(search.page) || 1);

  const [movements, total] = await Promise.all([
    db.inventoryMovement.findMany({
      where: { companyId: company.id, itemId: item.id, ...(dateFilter ? { date: dateFilter } : {}) },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.inventoryMovement.count({
      where: { companyId: company.id, itemId: item.id, ...(dateFilter ? { date: dateFilter } : {}) },
    }),
  ]);

  // Batch-resolve each movement's party name and the ORIGINAL selling price
  // (distinct from unitCostCents, which is the COGS/inventory cost) — one
  // query per source type instead of one per row.
  const invoiceIds = [...new Set(movements.filter((m) => m.sourceType === "INVOICE" && m.sourceId).map((m) => m.sourceId!))];
  const billIds = [...new Set(movements.filter((m) => m.sourceType === "BILL" && m.sourceId).map((m) => m.sourceId!))];
  const creditIds = [...new Set(movements.filter((m) => m.sourceType === "CREDIT_NOTE" && m.sourceId).map((m) => m.sourceId!))];
  const lineIds = [...new Set(movements.filter((m) => m.sourceLineId).map((m) => m.sourceLineId!))];

  const [invoices, bills, credits, invoiceLines, billLines] = await Promise.all([
    invoiceIds.length
      ? db.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, customer: { select: { name: true } } } })
      : [],
    billIds.length
      ? db.bill.findMany({ where: { id: { in: billIds } }, select: { id: true, vendor: { select: { name: true } } } })
      : [],
    creditIds.length
      ? db.creditNote.findMany({
          where: { id: { in: creditIds } },
          select: { id: true, customer: { select: { name: true } }, vendor: { select: { name: true } } },
        })
      : [],
    lineIds.length ? db.invoiceLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, unitPriceCents: true } }) : [],
    lineIds.length ? db.billLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, unitPriceCents: true } }) : [],
  ]);
  const invoicePartyById = new Map(invoices.map((i) => [i.id, i.customer.name]));
  const billPartyById = new Map(bills.map((b) => [b.id, b.vendor.name]));
  const creditPartyById = new Map(credits.map((c) => [c.id, c.customer?.name ?? c.vendor?.name ?? null]));
  const invoiceLinePriceById = new Map(invoiceLines.map((l) => [l.id, l.unitPriceCents]));
  const billLinePriceById = new Map(billLines.map((l) => [l.id, l.unitPriceCents]));

  function partyName(m: (typeof movements)[number]): string | null {
    if (!m.sourceId) return null;
    if (m.sourceType === "INVOICE") return invoicePartyById.get(m.sourceId) ?? null;
    if (m.sourceType === "BILL") return billPartyById.get(m.sourceId) ?? null;
    if (m.sourceType === "CREDIT_NOTE") return creditPartyById.get(m.sourceId) ?? null;
    return null;
  }
  function sellingPriceCents(m: (typeof movements)[number]): number | null {
    if (!m.sourceLineId) return null;
    if (m.sourceType === "INVOICE" || m.sourceType === "CREDIT_NOTE") return invoiceLinePriceById.get(m.sourceLineId) ?? null;
    if (m.sourceType === "BILL") return billLinePriceById.get(m.sourceLineId) ?? null;
    return null;
  }

  const fmt = (cents: number) => formatMoney(cents, { currency });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (search.from) params.set("from", search.from);
    if (search.to) params.set("to", search.to);
    params.set("page", String(p));
    return `?${params.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={`${item.code} — ${item.name}`}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: item.code }]}
        description="Every purchase, sale, return, adjustment and reversal that built this item's quantity and average cost — the same figures the Inventory page and the general ledger show."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="On hand" value={`${formatQty(item.quantityOnHandMilli)} ${item.unit}`} />
        <Stat label="Average cost" value={fmt(item.averageCostCents)} />
        <Stat label="Value" value={fmt(Math.round((item.quantityOnHandMilli * item.averageCostCents) / 1000))} />
        <Stat label="Selling price" value={fmt(item.unitPriceCents)} />
      </div>

      <div className="mb-4">
        <DateRangeFilter label="Movement date" />
      </div>

      <Card padded={false}>
        {movements.length === 0 ? (
          <p className="p-5 text-[0.8125rem] text-muted-ink">No stock movements in this range.</p>
        ) : (
          <div className="thin-scroll overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th width="6rem">Date</Th>
                  <Th width="8rem">Type</Th>
                  <Th>Document</Th>
                  <Th>Party</Th>
                  <Th width="6rem" align="right">Qty</Th>
                  <Th width="6rem" align="right">Running qty</Th>
                  <Th width="7rem" align="right">Sold at</Th>
                  <Th width="7rem" align="right">Cost applied</Th>
                  <Th width="8rem" align="right">Movement cost</Th>
                  <Th width="8rem" align="right">Running value</Th>
                  <Th width="7rem" align="right">Avg cost</Th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const sourceHref = m.sourceId && SOURCE_HREF[m.sourceType]?.(m.sourceId);
                  const runningValueCents = Math.round((m.quantityOnHandAfterMilli * m.averageCostAfterCents) / 1000);
                  const sellPrice = sellingPriceCents(m);
                  const isSaleSide = m.type === "SALE" || m.type === "SALE_RETURN";
                  return (
                    <Tr key={m.id}>
                      <Td className="whitespace-nowrap">{formatDate(m.date)}</Td>
                      <Td>{TYPE_LABELS[m.type] ?? m.type}</Td>
                      <Td>
                        {sourceHref ? (
                          <Link href={sourceHref} className="text-brand-700 hover:underline">
                            {m.sourceNumber ?? m.sourceType}
                          </Link>
                        ) : (
                          m.sourceNumber ?? "—"
                        )}
                      </Td>
                      <Td className="text-muted-ink">{partyName(m) ?? "—"}</Td>
                      <Td align="right" className={`tnum ${m.quantityMilli >= 0 ? "text-positive" : "text-negative"}`}>
                        {m.quantityMilli >= 0 ? "+" : ""}
                        {formatQty(m.quantityMilli)}
                      </Td>
                      <Td align="right" className="tnum">{formatQty(m.quantityOnHandAfterMilli)}</Td>
                      <Td align="right" className="tnum">{isSaleSide && sellPrice !== null ? fmt(sellPrice) : "—"}</Td>
                      <Td align="right" className="tnum">{fmt(m.unitCostCents)}</Td>
                      <Td align="right" className="tnum">{fmt(m.totalCostCents)}</Td>
                      <Td align="right" className="tnum">{fmt(runningValueCents)}</Td>
                      <Td align="right" className="tnum">{fmt(m.averageCostAfterCents)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="no-print flex items-center justify-between border-t border-paper-200 px-4 py-3 text-[0.8125rem]">
            <span className="text-muted-ink">
              Page {page} of {totalPages} — {total} movement(s)
            </span>
            <span className="flex gap-2">
              {page > 1 && <LinkButton href={qs(page - 1)}>Previous</LinkButton>}
              {page < totalPages && <LinkButton href={qs(page + 1)}>Next</LinkButton>}
            </span>
          </div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-muted-ink">{label}</p>
      <p className="tnum mt-1 text-[1.0625rem] font-semibold text-ink-950">{value}</p>
    </Card>
  );
}
