import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today } from "@/lib/dates";
import { continuitySchedule } from "@/server/accounting/fixed-assets";
import { Card, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { RangePicker } from "@/components/filter-bar";

export const metadata = { title: "Fixed asset continuity schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await requireCapability(CAPABILITIES.JOURNALS);
  const currency = company.baseCurrency;
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(defaults.end));

  const rows = await continuitySchedule(company.id, from, to);
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);

  const cost: [string, (r: (typeof rows)[number]) => number][] = [
    ["Opening cost", (r) => r.openingCostCents],
    ["Additions", (r) => r.additionsCents],
    ["Disposals", (r) => -r.disposalsCents],
    ["Closing cost", (r) => r.closingCostCents],
  ];
  const accum: [string, (r: (typeof rows)[number]) => number][] = [
    ["Opening accum.", (r) => r.openingAccumulatedCents],
    ["Depreciation", (r) => r.depreciationCents],
    ["Disposals", (r) => -r.disposalAccumulatedCents],
    ["Closing accum.", (r) => r.closingAccumulatedCents],
    ["Net book value", (r) => r.netBookValueCents],
  ];
  const columns = [...cost, ...accum];

  return (
    <>
      <PageHeader
        title="Fixed asset continuity schedule"
        breadcrumb={[{ label: "Accounting", href: "/accounting/chart-of-accounts" }, { label: "Fixed assets", href: "/accounting/fixed-assets" }, { label: "Continuity schedule" }]}
        description="Cost and accumulated depreciation by category: opening, additions, disposals, depreciation and closing for the period."
      />
      <div className="mb-4"><RangePicker from={isoDate(from)} to={isoDate(to)} /></div>
      <Card className="p-5">
        <div className="thin-scroll overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Category</Th>
                {columns.map(([label]) => <Th key={label} width="7.5rem" align="right">{label}</Th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.categoryId}>
                  <Td className="font-medium text-ink-900">{r.categoryName}</Td>
                  {columns.map(([label, pick]) => <Td key={label} align="right"><Money cents={pick(r)} currency={currency} /></Td>)}
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td className="pt-3 font-semibold text-ink-900">Total</Td>
                {columns.map(([label, pick]) => <Td key={label} align="right" className="pt-3"><Money cents={sum(pick)} currency={currency} bold /></Td>)}
              </tr>
            </tfoot>
          </Table>
        </div>
      </Card>
    </>
  );
}
