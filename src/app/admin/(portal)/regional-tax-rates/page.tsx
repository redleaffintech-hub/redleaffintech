import Link from "next/link";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { PROVINCES } from "@/lib/enums";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Badge, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, EmptyRow } from "@/components/admin/ui";
import { combinedRateMicro } from "@/server/tax/regional-rates";
import { RegionalTaxRateRowActions } from "./row-actions";

export const metadata = { title: "Regional tax rates" };

const PROVINCE_LABEL: Map<string, string> = new Map(PROVINCES.map((p) => [p.code, p.name]));

function rateLabel(micro: number): string {
  const pct = micro / 10_000;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

/**
 * The platform's central GST/HST/PST/QST/RST reference.
 *
 * One row per province PER EFFECTIVE PERIOD — a province with a scheduled
 * future change, or a closed-out historical regime, appears more than once.
 * That is deliberate: "view rate history" is this same list, not a separate
 * screen, and it is what makes an overlap or a gap visible at a glance.
 */
export default async function RegionalTaxRatesPage() {
  const actor = await requirePlatformAdmin();
  const rates = await db.regionalTaxRate.findMany({
    orderBy: [{ province: "asc" }, { effectiveFrom: "desc" }],
  });

  const now = new Date();
  const currentCount = rates.filter(
    (r) => r.isActive && r.effectiveFrom <= now && (!r.effectiveTo || r.effectiveTo >= now),
  ).length;
  const scheduledCount = rates.filter((r) => r.effectiveFrom > now).length;

  return (
    <>
      <AdminPageHeader
        title="Regional tax rates"
        description="The GST/HST and provincial sales-tax rates every client company's tax-code setup draws from. Publishing a change here affects new tax codes only — it never rewrites a company's existing tax code or a posted tax entry."
        breadcrumb={[{ label: "Regional tax rates" }]}
        actions={
          <Link
            href="/admin/regional-tax-rates/new"
            className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
          >
            Add a future rate
          </Link>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <SummaryTile label="Provinces & territories" value={PROVINCES.length} />
        <SummaryTile label="Currently in effect" value={currentCount} />
        <SummaryTile label="Scheduled future changes" value={scheduledCount} />
      </div>

      <AdminCard>
        <Table>
          <thead>
            <tr>
              <Th>Province / territory</Th>
              <Th width="4rem">Code</Th>
              <Th width="6rem">Federal</Th>
              <Th width="6rem" align="right">GST/HST</Th>
              <Th width="6rem">Provincial</Th>
              <Th width="6rem" align="right">Prov. rate</Th>
              <Th width="6rem" align="right">Combined</Th>
              <Th width="7rem">Effective</Th>
              <Th width="7rem">Expiry</Th>
              <Th width="5rem">Status</Th>
              <Th width="9rem">Last updated</Th>
              <Th width="11rem" align="right">{""}</Th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 ? (
              <EmptyRow colSpan={12}>No regional tax rates configured yet.</EmptyRow>
            ) : (
              rates.map((rate) => {
                const isFuture = rate.effectiveFrom > now;
                const isCurrent =
                  rate.isActive && rate.effectiveFrom <= now && (!rate.effectiveTo || rate.effectiveTo >= now);
                const isEnded = Boolean(rate.effectiveTo && rate.effectiveTo < now);
                return (
                  <Tr key={rate.id}>
                    <Td className="font-medium text-ink-900">{PROVINCE_LABEL.get(rate.province) ?? rate.province}</Td>
                    <Td className="tnum text-muted-ink">{rate.province}</Td>
                    <Td>{rate.federalType}</Td>
                    <Td align="right" className="tnum">{rateLabel(rate.federalRateMicro)}</Td>
                    <Td className="text-muted-ink">{rate.provincialType === "NONE" ? "None" : rate.provincialType}</Td>
                    <Td align="right" className="tnum text-muted-ink">
                      {rate.provincialType === "NONE" ? "—" : rateLabel(rate.provincialRateMicro)}
                    </Td>
                    <Td align="right" className="tnum font-medium text-ink-900">
                      {rateLabel(combinedRateMicro(rate))}
                    </Td>
                    <Td className="text-[0.8125rem] text-muted-ink">{formatDate(rate.effectiveFrom)}</Td>
                    <Td className="text-[0.8125rem] text-muted-ink">
                      {rate.effectiveTo ? formatDate(rate.effectiveTo) : "Ongoing"}
                    </Td>
                    <Td>
                      {!rate.isActive ? (
                        <Badge>inactive</Badge>
                      ) : isFuture ? (
                        <Badge tone="info">scheduled</Badge>
                      ) : isEnded ? (
                        <Badge>ended</Badge>
                      ) : isCurrent ? (
                        <Badge tone="positive">current</Badge>
                      ) : (
                        <Badge>inactive</Badge>
                      )}
                    </Td>
                    <Td className="text-[0.75rem] text-muted-ink">{formatDateTime(rate.updatedAt)}</Td>
                    <Td align="right">
                      <RegionalTaxRateRowActions
                        csrfToken={actor.csrfToken}
                        rateId={rate.id}
                        regionLabel={PROVINCE_LABEL.get(rate.province) ?? rate.province}
                        isFuture={isFuture}
                        isActive={rate.isActive}
                      />
                    </Td>
                  </Tr>
                );
              })
            )}
          </tbody>
        </Table>
      </AdminCard>
    </>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-paper-300 bg-white px-4 py-3">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className="tnum mt-0.5 text-[1.375rem] font-semibold text-ink-950">{value}</p>
    </div>
  );
}
