import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { AssetForm } from "../fixed-asset-forms";

export const metadata = { title: "Add fixed asset" };

export default async function NewAssetPage() {
  const { company } = await requireCapability(CAPABILITIES.JOURNALS);
  const categories = await db.fixedAssetCategory.findMany({ where: { companyId: company.id, isActive: true }, orderBy: { name: "asc" } });

  return (
    <>
      <PageHeader
        title="Add fixed asset"
        breadcrumb={[{ label: "Accounting", href: "/accounting/chart-of-accounts" }, { label: "Fixed assets", href: "/accounting/fixed-assets" }, { label: "Add" }]}
        description="The cost normally reaches the ledger through the bill or expense you paid it on; this registers the asset so it can be depreciated."
      />
      <Card className="max-w-5xl p-5">
        {categories.length === 0 ? (
          <EmptyState title="Set up a category first" description="An asset takes its depreciation policy and accounts from its category." action={<LinkButton href="/accounting/fixed-assets/categories" variant="primary">Set up categories</LinkButton>} />
        ) : (
          <AssetForm
            categories={categories.map((c) => ({
              id: c.id, name: c.name, method: c.method, usefulLifeMonths: c.usefulLifeMonths,
              decliningRatePercent: c.decliningRateMicro / 10_000, residualPercent: c.residualPercentMicro / 10_000,
            }))}
          />
        )}
      </Card>
    </>
  );
}
