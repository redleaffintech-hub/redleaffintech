import Link from "next/link";
import { db } from "@/lib/db";
import { requirePlatformAdmin } from "@/server/admin/guard";
import { PROVINCES } from "@/lib/enums";
import { formatDate } from "@/lib/dates";
import { Badge, Table, Td, Th, Tr } from "@/components/ui";
import { AdminCard, AdminPageHeader, EmptyRow } from "@/components/admin/ui";
import { BracketRowActions } from "./row-actions";

export const metadata = { title: "Payroll tax brackets" };

const PROVINCE_LABEL: Map<string, string> = new Map(PROVINCES.map((p) => [p.code, p.name]));
const jurisdictionLabel = (code: string) => (code === "FEDERAL" ? "Federal" : (PROVINCE_LABEL.get(code) ?? code));

function pct(micro: number): string {
  const value = micro / 10_000;
  return `${Number.isInteger(value) ? value : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`;
}
function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA")}`;
}

/**
 * Marginal income-tax brackets, grouped visually by jurisdiction and
 * effective date — several rows form one year's bracket set (see
 * PayrollTaxBracket's schema comment). Each row is still its own record,
 * added/edited independently.
 */
export default async function PayrollTaxBracketsPage() {
  const actor = await requirePlatformAdmin();
  const brackets = await db.payrollTaxBracket.findMany({
    orderBy: [{ jurisdiction: "asc" }, { effectiveFrom: "desc" }, { minCents: "asc" }],
  });
  const now = new Date();

  return (
    <>
      <AdminPageHeader
        title="Payroll tax brackets"
        description="Federal and provincial marginal income-tax brackets, one row per bracket. Several rows sharing a jurisdiction and effective date form one year's bracket set. Publishing a change never rewrites an already-posted pay run."
        breadcrumb={[{ label: "Payroll rates" }, { label: "Tax brackets" }]}
        actions={
          <>
            <Link
              href="/admin/payroll-rates/tax-brackets/import"
              className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
            >
              Import CSV
            </Link>
            <Link
              href="/admin/payroll-rates/tax-brackets/new"
              className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
            >
              Add a bracket
            </Link>
          </>
        }
      />

      <AdminCard>
        <Table>
          <thead>
            <tr>
              <Th>Jurisdiction</Th>
              <Th align="right">Bracket</Th>
              <Th align="right">Rate</Th>
              <Th align="right">Basic personal amount</Th>
              <Th width="7rem">Effective</Th>
              <Th width="7rem">Expiry</Th>
              <Th width="5rem">Status</Th>
              <Th width="9rem" align="right">{""}</Th>
            </tr>
          </thead>
          <tbody>
            {brackets.length === 0 ? (
              <EmptyRow colSpan={8}>No payroll tax brackets configured yet.</EmptyRow>
            ) : (
              brackets.map((bracket) => {
                const isFuture = bracket.effectiveFrom > now;
                const isCurrent = bracket.isActive && bracket.effectiveFrom <= now && (!bracket.effectiveTo || bracket.effectiveTo >= now);
                const isEnded = Boolean(bracket.effectiveTo && bracket.effectiveTo < now);
                return (
                  <Tr key={bracket.id}>
                    <Td className="font-medium text-ink-900">{jurisdictionLabel(bracket.jurisdiction)}</Td>
                    <Td align="right" className="tnum">
                      {dollars(bracket.minCents)} – {bracket.maxCents !== null ? dollars(bracket.maxCents) : "and up"}
                    </Td>
                    <Td align="right" className="tnum font-medium">{pct(bracket.rateMicro)}</Td>
                    <Td align="right" className="tnum text-muted-ink">{dollars(bracket.basicPersonalAmountCents)}</Td>
                    <Td className="text-[0.8125rem] text-muted-ink">{formatDate(bracket.effectiveFrom)}</Td>
                    <Td className="text-[0.8125rem] text-muted-ink">{bracket.effectiveTo ? formatDate(bracket.effectiveTo) : "Ongoing"}</Td>
                    <Td>
                      {!bracket.isActive ? <Badge>inactive</Badge> : isFuture ? <Badge tone="info">scheduled</Badge> : isEnded ? <Badge>ended</Badge> : isCurrent ? <Badge tone="positive">current</Badge> : <Badge>inactive</Badge>}
                    </Td>
                    <Td align="right">
                      <BracketRowActions csrfToken={actor.csrfToken} bracketId={bracket.id} isFuture={isFuture} />
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
