import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Badge, Card, CardHeader, DefinitionList, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { DisposeForm } from "../fixed-asset-forms";

export const metadata = { title: "Fixed asset" };

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.JOURNALS);
  const { id } = await params;
  const currency = company.baseCurrency;

  const asset = await db.fixedAsset.findFirst({
    where: { id, companyId: company.id },
    include: { category: true, depreciations: { orderBy: { periodEnd: "desc" } } },
  });
  if (!asset) notFound();

  const accumulated = asset.openingAccumulatedCents + asset.depreciations.reduce((s, d) => s + d.amountCents, 0);
  const nbv = asset.costCents - accumulated;

  const accounts = asset.status === "ACTIVE"
    ? await db.account.findMany({
        where: { companyId: company.id, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true, type: true, subtype: true },
      })
    : [];

  return (
    <>
      <PageHeader
        title={`${asset.number} · ${asset.name}`}
        breadcrumb={[{ label: "Accounting", href: "/accounting/chart-of-accounts" }, { label: "Fixed assets", href: "/accounting/fixed-assets" }, { label: asset.number }]}
        description={asset.description ?? undefined}
        actions={asset.status === "DISPOSED" ? <Badge tone="neutral">Disposed {formatDate(asset.disposalDate)}</Badge> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem] lg:items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <DefinitionList
              items={[
                { label: "Category", value: asset.category.name },
                { label: "Method", value: asset.method === "STRAIGHT_LINE" ? `Straight-line, ${asset.usefulLifeMonths} months` : `Declining balance, ${asset.decliningRateMicro / 10_000}% a year` },
                { label: "Acquired", value: formatDate(asset.acquisitionDate) },
                { label: "In service", value: formatDate(asset.inServiceDate) },
                { label: "Cost", value: <Money cents={asset.costCents} currency={currency} /> },
                { label: "Residual value", value: <Money cents={asset.residualCents} currency={currency} /> },
                { label: "Accumulated depreciation", value: <Money cents={accumulated} currency={currency} /> },
                { label: "Net book value", value: <Money cents={nbv} currency={currency} bold /> },
                { label: "Location", value: asset.location ?? "—" },
                { label: "Serial number", value: asset.serialNumber ?? "—" },
                { label: "Vendor", value: asset.vendorName ?? "—" },
                ...(asset.status === "DISPOSED"
                  ? [
                      { label: "Disposal proceeds", value: <Money cents={asset.disposalProceedsCents} currency={currency} /> },
                      {
                        label: "Disposal entry",
                        value: asset.disposalJournalEntryId ? <Link href={`/accounting/journals/${asset.disposalJournalEntryId}`} className="text-brand-700 hover:underline">View journal entry</Link> : "—",
                      },
                    ]
                  : []),
              ]}
            />
          </Card>

          <Card className="p-5">
            <CardHeader title="Depreciation history" subtitle={asset.openingAccumulatedCents > 0 ? `Includes ${(asset.openingAccumulatedCents / 100).toFixed(2)} brought forward at ${formatDate(asset.openingAsOf)}` : undefined} />
            {asset.depreciations.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-muted-ink">No depreciation posted yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Month</Th>
                    <Th width="9rem" align="right">Charge</Th>
                  </tr>
                </thead>
                <tbody>
                  {asset.depreciations.map((d) => (
                    <Tr key={d.id}>
                      <Td>{formatDate(d.periodEnd)}</Td>
                      <Td align="right"><Money cents={d.amountCents} currency={currency} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        {asset.status === "ACTIVE" && (
          <Card className="p-5">
            <CardHeader title="Dispose of asset" subtitle="Sold, scrapped or written off" />
            <div className="mt-3">
              <DisposeForm
                assetId={asset.id}
                bankAccounts={accounts.filter((a) => ["BANK", "CASH"].includes(a.subtype))}
                gainLossAccounts={accounts.filter((a) => a.type === "REVENUE" || a.type === "EXPENSE")}
              />
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
