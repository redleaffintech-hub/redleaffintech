import Link from "next/link";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Badge, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, EmptyRow } from "@/components/admin/ui";
import { StatutoryRateRowActions } from "./row-actions";

export const metadata = { title: "Payroll statutory rates" };

function pct(micro: number): string {
  const value = micro / 10_000;
  return `${Number.isInteger(value) ? value : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}
function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA")}`;
}

/**
 * CPP/CPP2/EI parameters, one row per year — the platform-wide reference
 * src/server/payroll/tax-engine.ts reads at pay-run calculation time.
 * Publishing a new row only changes what the NEXT calculation uses; it never
 * rewrites an already-posted PayRunLine.
 */
export default async function PayrollStatutoryRatesPage() {
  const actor = await requirePlatformAdmin();
  const rates = await db.payrollStatutoryRate.findMany({ orderBy: { effectiveFrom: "desc" } });
  const now = new Date();

  return (
    <>
      <AdminPageHeader
        title="Payroll statutory rates (CPP / CPP2 / EI)"
        description="Federal CPP, CPP2 and EI parameters, one row per year. Every company's pay-run calculation reads whichever row is in force on the pay date — publishing a new row never rewrites an already-posted pay run."
        breadcrumb={[{ label: "Payroll rates" }, { label: "Statutory (CPP/CPP2/EI)" }]}
        actions={
          <Link
            href="/admin/payroll-rates/statutory/new"
            className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
          >
            Add a future rate
          </Link>
        }
      />

      <AdminCard>
        <Table>
          <thead>
            <tr>
              <Th>CPP</Th>
              <Th>CPP2</Th>
              <Th>EI</Th>
              <Th>QPIP</Th>
              <Th width="7rem">Effective</Th>
              <Th width="7rem">Expiry</Th>
              <Th width="5rem">Status</Th>
              <Th width="9rem">Last updated</Th>
              <Th width="9rem" align="right">{""}</Th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 ? (
              <EmptyRow colSpan={9}>No payroll statutory rates configured yet.</EmptyRow>
            ) : (
              rates.map((rate) => {
                const isFuture = rate.effectiveFrom > now;
                const isCurrent = rate.isActive && rate.effectiveFrom <= now && (!rate.effectiveTo || rate.effectiveTo >= now);
                const isEnded = Boolean(rate.effectiveTo && rate.effectiveTo < now);
                return (
                  <Tr key={rate.id}>
                    <Td className="tnum">{pct(rate.cppRateMicro)} <span className="text-muted-ink">up to {dollars(rate.cppMaxPensionableEarningsCents)}</span></Td>
                    <Td className="tnum">{pct(rate.cpp2RateMicro)} <span className="text-muted-ink">up to {dollars(rate.cpp2MaxPensionableEarningsCents)}</span></Td>
                    <Td className="tnum">
                      {pct(rate.eiRateMicro)} <span className="text-muted-ink">up to {dollars(rate.eiMaxInsurableEarningsCents)}</span>
                      <br />
                      <span className="text-muted-ink">QC {pct(rate.eiRateMicroQuebec)}</span>
                    </Td>
                    <Td className="tnum">{pct(rate.qpipRateMicro)} <span className="text-muted-ink">up to {dollars(rate.qpipMaxInsurableEarningsCents)}</span></Td>
                    <Td className="text-[0.8125rem] text-muted-ink">{formatDate(rate.effectiveFrom)}</Td>
                    <Td className="text-[0.8125rem] text-muted-ink">{rate.effectiveTo ? formatDate(rate.effectiveTo) : "Ongoing"}</Td>
                    <Td>
                      {!rate.isActive ? <Badge>inactive</Badge> : isFuture ? <Badge tone="info">scheduled</Badge> : isEnded ? <Badge>ended</Badge> : isCurrent ? <Badge tone="positive">current</Badge> : <Badge>inactive</Badge>}
                    </Td>
                    <Td className="text-[0.75rem] text-muted-ink">{formatDateTime(rate.updatedAt)}</Td>
                    <Td align="right">
                      <StatutoryRateRowActions csrfToken={actor.csrfToken} rateId={rate.id} isFuture={isFuture} />
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
