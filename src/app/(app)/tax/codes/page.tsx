import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Card, CardHeader, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { PROVINCES } from "@/lib/enums";
import { currentRegionalTaxRate } from "@/server/tax/regional-rates";

export const metadata = { title: "Tax codes" };

export default async function TaxCodesPage() {
  await requireCapability(CAPABILITIES.TAX_FILING);

  // Reference table: the platform's rate in force today for every province. Every
  // company already has the codes for every province, so there is nothing to add or
  // manage here — this page only shows the rates those codes carry.
  const asOf = new Date();
  const rateRows = await Promise.all(
    PROVINCES.map(async (province) => ({ province, rate: await currentRegionalTaxRate(province.code, asOf) })),
  );
  const pct = (micro: number) => `${(micro / 10_000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
  // NONE under an HST province means no separate PST exists (N/A); NONE under
  // GST-only means a PST of zero is levied (0%).
  const pstCell = (rate: NonNullable<(typeof rateRows)[number]["rate"]>) =>
    rate.provincialType === "NONE" ? (rate.federalType === "HST" ? "N/A" : "0%") : pct(rate.provincialRateMicro);

  return (
    <>
      <PageHeader
        title="Tax codes"
        breadcrumb={[{ label: "Tax Centre", href: "/tax" }, { label: "Tax codes" }]}
        description={`Rates are effective-dated, never hard-coded. A posted transaction keeps the rate that applied on its date, so changing a rate means superseding the code rather than editing it.`}
      />

      <Card className="mb-4 p-5">
        <CardHeader
          title="GST/HST and PST rates by province"
          subtitle="Reference rates in force today. Changing a rate affects only tax codes created afterwards — existing codes, posted documents and filed returns keep the rate they used."
        />
        <div className="thin-scroll mt-3 overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>Province</Th>
                <Th width="9rem" align="right">GST and HST</Th>
                <Th width="9rem" align="right">PST</Th>
              </tr>
            </thead>
            <tbody>
              {rateRows.map(({ province, rate }) => (
                <Tr key={province.code}>
                  <Td>
                    {province.name}
                    {rate && <span className="block text-[0.6875rem] text-muted-ink">effective {formatDate(rate.effectiveFrom)}</span>}
                  </Td>
                  <Td align="right" className="tnum">{rate ? pct(rate.federalRateMicro) : "—"}</Td>
                  <Td align="right" className="tnum">{rate ? pstCell(rate) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
          N/A: the province has HST, with no separate PST. Quebec&apos;s column shows QST. Rates are maintained centrally by
          the platform administrator with an effective date and an audit trail; they are reference values to check against the CRA.
        </p>
      </Card>
    </>
  );
}
