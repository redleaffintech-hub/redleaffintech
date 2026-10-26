import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Badge, Card, EmptyState, LinkButton, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export const metadata = { title: "Fixed assets" };

export default async function FixedAssetsPage() {
  const { company } = await requireCapability(CAPABILITIES.JOURNALS);
  const currency = company.baseCurrency;

  const [assets, categoryCount] = await Promise.all([
    db.fixedAsset.findMany({
      where: { companyId: company.id },
      include: { category: { select: { name: true } }, depreciations: { select: { amountCents: true } } },
      orderBy: [{ status: "asc" }, { number: "asc" }],
    }),
    db.fixedAssetCategory.count({ where: { companyId: company.id } }),
  ]);

  const rows = assets.map((a) => {
    const accumulated = a.openingAccumulatedCents + a.depreciations.reduce((s, d) => s + d.amountCents, 0);
    return { ...a, accumulated, nbv: a.costCents - accumulated };
  });
  const active = rows.filter((r) => r.status === "ACTIVE");
  const totals = active.reduce((t, r) => ({ cost: t.cost + r.costCents, accumulated: t.accumulated + r.accumulated, nbv: t.nbv + r.nbv }), { cost: 0, accumulated: 0, nbv: 0 });

  return (
    <>
      <PageHeader
        title="Fixed assets"
        breadcrumb={[{ label: "Accounting", href: "/accounting/chart-of-accounts" }, { label: "Fixed assets" }]}
        description="Register of assets by category. Run depreciation once a month and it posts to the profit & loss automatically."
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/accounting/fixed-assets/categories">Categories</LinkButton>
            <LinkButton href="/accounting/fixed-assets/schedule">Continuity schedule</LinkButton>
            <LinkButton href="/accounting/fixed-assets/depreciation">Run depreciation</LinkButton>
            <LinkButton href="/accounting/fixed-assets/new" variant="primary">Add asset</LinkButton>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          ["Cost", totals.cost],
          ["Accumulated depreciation", totals.accumulated],
          ["Net book value", totals.nbv],
        ].map(([label, cents]) => (
          <Card key={label as string} className="p-4">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
            <p className="tnum mt-1 text-[1.375rem] font-semibold text-ink-950"><Money cents={cents as number} currency={currency} /></p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        {rows.length === 0 ? (
          <EmptyState
            title="No fixed assets yet"
            description={categoryCount === 0 ? "Start by setting up categories (Leasehold improvements, Office furniture, Computer equipment…) and their depreciation policy." : "Add your first asset to the register."}
            action={<LinkButton href={categoryCount === 0 ? "/accounting/fixed-assets/categories" : "/accounting/fixed-assets/new"} variant="primary">{categoryCount === 0 ? "Set up categories" : "Add asset"}</LinkButton>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="6rem">Number</Th>
                <Th>Asset</Th>
                <Th>Category</Th>
                <Th width="6.5rem">In service</Th>
                <Th width="8rem" align="right">Cost</Th>
                <Th width="8rem" align="right">Accum. depr.</Th>
                <Th width="8rem" align="right">Net book value</Th>
                <Th width="6rem">Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <Tr key={a.id}>
                  <Td><Link href={`/accounting/fixed-assets/${a.id}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">{a.number}</Link></Td>
                  <Td>{a.name}{a.location && <span className="block text-[0.75rem] text-muted-ink">{a.location}</span>}</Td>
                  <Td className="text-muted-ink">{a.category.name}</Td>
                  <Td className="text-muted-ink">{formatDate(a.inServiceDate)}</Td>
                  <Td align="right"><Money cents={a.costCents} currency={currency} /></Td>
                  <Td align="right"><Money cents={a.accumulated} currency={currency} /></Td>
                  <Td align="right"><Money cents={a.nbv} currency={currency} bold /></Td>
                  <Td>{a.status === "DISPOSED" ? <Badge tone="neutral">Disposed</Badge> : a.nbv <= a.residualCents ? <Badge tone="info">Fully depreciated</Badge> : <Badge tone="positive">Active</Badge>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
