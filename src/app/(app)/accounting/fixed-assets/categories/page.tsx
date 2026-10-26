import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, CardHeader, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { CategoryForm } from "../fixed-asset-forms";

export const metadata = { title: "Fixed asset categories" };

export default async function CategoriesPage() {
  const { company } = await requireCapability(CAPABILITIES.JOURNALS);

  const [categories, accounts] = await Promise.all([
    db.fixedAssetCategory.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" }, include: { _count: { select: { assets: true } } } }),
    db.account.findMany({
      where: { companyId: company.id, isActive: true, type: { in: ["ASSET", "EXPENSE"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
  ]);
  const assetAccounts = accounts.filter((a) => a.type === "ASSET");
  const expenseAccounts = accounts.filter((a) => a.type === "EXPENSE");
  const label = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : "—";
  };

  return (
    <>
      <PageHeader
        title="Asset categories & depreciation policy"
        breadcrumb={[{ label: "Accounting", href: "/accounting/chart-of-accounts" }, { label: "Fixed assets", href: "/accounting/fixed-assets" }, { label: "Categories" }]}
        description="Each category carries its own depreciation policy and the three accounts its assets post to. A new asset copies the policy when it is added, so editing a category never rewrites assets already in the register."
      />

      <Card className="mb-4 p-5">
        <CardHeader title="Add a category" subtitle="e.g. Leasehold improvements, Office furniture, Computer equipment" />
        <div className="mt-4">
          <CategoryForm assetAccounts={assetAccounts} expenseAccounts={expenseAccounts} />
        </div>
      </Card>

      <Card className="p-5">
        {categories.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-ink">No categories yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>Policy</Th>
                <Th>Cost / accumulated / expense accounts</Th>
                <Th width="5rem" align="right">Assets</Th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium text-ink-900">{c.name}</Td>
                  <Td className="text-muted-ink">
                    {c.method === "STRAIGHT_LINE" ? `Straight-line, ${c.usefulLifeMonths} months` : `Declining balance, ${c.decliningRateMicro / 10_000}% a year`}
                    {c.residualPercentMicro > 0 && `, ${c.residualPercentMicro / 10_000}% residual`}
                  </Td>
                  <Td className="text-[0.75rem] text-muted-ink">
                    {label(c.assetAccountId)} · {label(c.accumulatedDepreciationAccountId)} · {label(c.depreciationExpenseAccountId)}
                  </Td>
                  <Td align="right">{c._count.assets}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
