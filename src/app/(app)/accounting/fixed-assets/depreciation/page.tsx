import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { previewDepreciation } from "@/server/accounting/fixed-assets";
import { Badge, Card, CardHeader, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { ReverseRunButton, RunControls } from "../fixed-asset-forms";

export const metadata = { title: "Run depreciation" };

export default async function DepreciationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await requireCapability(CAPABILITIES.JOURNALS);
  const currency = company.baseCurrency;
  const params = await searchParams;

  // Default: the last completed month.
  const now = today();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const requested = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : lastMonth;

  const [preview, runs] = await Promise.all([
    previewDepreciation(company.id, `${requested}-01`),
    db.depreciationRun.findMany({ where: { companyId: company.id }, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }], take: 24 }),
  ]);
  const latestPostedId = runs.find((r) => r.status === "POSTED")?.id;

  return (
    <>
      <PageHeader
        title="Run depreciation"
        breadcrumb={[{ label: "Accounting", href: "/accounting/chart-of-accounts" }, { label: "Fixed assets", href: "/accounting/fixed-assets" }, { label: "Run depreciation" }]}
        description="Posts one journal entry for the month — debit depreciation expense, credit accumulated depreciation — for every asset that has not been charged yet. Running it again for the same month finds nothing left to post."
      />

      <Card className="mb-4 p-5">
        <RunControls month={requested} hasItems={preview.items.length > 0} />
      </Card>

      <Card className="mb-4 p-5">
        <CardHeader title={`Preview through ${requested}`} subtitle={`${formatDate(preview.periodEnd)} · ${preview.items.length} asset(s)`} />
        {preview.items.length === 0 ? (
          <EmptyState title="Nothing to depreciate" description="Every active asset is already charged through this month, or none has reached its in-service date." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="6rem">Asset</Th>
                <Th>Name</Th>
                <Th>Category</Th>
                <Th width="8rem">Months</Th>
                <Th width="8rem" align="right">Depreciation</Th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((item) => (
                <Tr key={item.assetId}>
                  <Td className="tnum">{item.number}</Td>
                  <Td>{item.name}</Td>
                  <Td className="text-muted-ink">{item.categoryName}</Td>
                  <Td className="text-muted-ink">{item.months.length === 1 ? item.months[0].periodEnd.toISOString().slice(0, 7) : `${item.months.length} months (catch-up)`}</Td>
                  <Td align="right"><Money cents={item.totalCents} currency={currency} /></Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={4} className="pt-3 font-medium text-ink-700">Total to post</Td>
                <Td align="right" className="pt-3"><Money cents={preview.totalCents} currency={currency} bold /></Td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <CardHeader title="Previous runs" />
        {runs.length === 0 ? (
          <p className="mt-2 text-[0.8125rem] text-muted-ink">No depreciation has been posted yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="8rem">Through</Th>
                <Th width="12rem">Posted</Th>
                <Th width="8rem" align="right">Amount</Th>
                <Th width="6rem">Status</Th>
                <Th width="6rem">{""}</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Tr key={run.id}>
                  <Td>{formatDate(run.periodEnd)}</Td>
                  <Td className="text-muted-ink">{formatDateTime(run.createdAt)}</Td>
                  <Td align="right"><Money cents={run.totalCents} currency={currency} /></Td>
                  <Td>{run.status === "POSTED" ? <Badge tone="positive">Posted</Badge> : <Badge tone="neutral">Reversed</Badge>}</Td>
                  <Td align="right">{run.id === latestPostedId && <ReverseRunButton runId={run.id} />}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
