import { db } from "@/lib/db";
import { requireVisible } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PROVINCES } from "@/lib/enums";
import { formatDate } from "@/lib/dates";
import { formatMoney, formatRate } from "@/lib/money";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { JurisdictionSelect } from "./jurisdiction-select";

export const metadata = { title: "Payroll tax brackets" };

const PROVINCE_LABEL: Map<string, string> = new Map(PROVINCES.map((p) => [p.code, p.name]));
const jurisdictionLabel = (code: string) => (code === "FEDERAL" ? "Federal" : (PROVINCE_LABEL.get(code) ?? code));

interface BracketSet {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  basicPersonalAmountCents: number;
  rows: { minCents: number; maxCents: number | null; rateMicro: number }[];
}

export default async function PayrollTaxBracketsViewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company } = await requireVisible(CAPABILITIES.PAYROLL);
  const params = await searchParams;
  const requested = typeof params.jurisdiction === "string" ? params.jurisdiction.toUpperCase() : "";
  const jurisdiction = requested && (requested === "FEDERAL" || PROVINCE_LABEL.has(requested)) ? requested : company.province;

  const brackets = await db.payrollTaxBracket.findMany({
    where: { jurisdiction, isActive: true },
    orderBy: [{ effectiveFrom: "desc" }, { minCents: "asc" }],
  });
  const now = new Date();

  const sets: BracketSet[] = [];
  for (const bracket of brackets) {
    let set = sets.find(
      (s) => s.effectiveFrom.getTime() === bracket.effectiveFrom.getTime() && (s.effectiveTo?.getTime() ?? null) === (bracket.effectiveTo?.getTime() ?? null),
    );
    if (!set) {
      set = { effectiveFrom: bracket.effectiveFrom, effectiveTo: bracket.effectiveTo, basicPersonalAmountCents: bracket.basicPersonalAmountCents, rows: [] };
      sets.push(set);
    }
    set.rows.push({ minCents: bracket.minCents, maxCents: bracket.maxCents, rateMicro: bracket.rateMicro });
  }

  return (
    <>
      <PageHeader
        title="Payroll tax brackets"
        breadcrumb={[{ label: "Payroll" }, { label: "Tax brackets" }]}
        description="The federal and provincial marginal income-tax brackets this company's pay runs calculate withholding from. Maintained platform-wide by Red Leaf Fintech, the same figures every client uses for a given jurisdiction and year — view only, not editable here."
      />

      <div className="mb-4">
        <JurisdictionSelect jurisdiction={jurisdiction} companyProvince={company.province} />
      </div>

      {sets.length === 0 ? (
        <Card>
          <p className="text-[0.8125rem] text-muted-ink">No tax brackets have been published yet for {jurisdictionLabel(jurisdiction)}.</p>
        </Card>
      ) : (
        <div className="space-y-5">
          {sets.map((set) => {
            const isCurrent = set.effectiveFrom <= now && (!set.effectiveTo || set.effectiveTo >= now);
            const isFuture = set.effectiveFrom > now;
            return (
              <Card key={`${set.effectiveFrom.getTime()}`} padded={false}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-200 px-5 py-3.5">
                  <div>
                    <h2 className="text-[0.9375rem] font-semibold text-ink-900">
                      {jurisdictionLabel(jurisdiction)} — effective {formatDate(set.effectiveFrom)}
                      {set.effectiveTo ? ` to ${formatDate(set.effectiveTo)}` : ", ongoing"}
                    </h2>
                    <p className="mt-0.5 text-[0.75rem] text-muted-ink">Basic personal amount: {formatMoney(set.basicPersonalAmountCents)}</p>
                  </div>
                  {isCurrent ? <Badge tone="positive">current</Badge> : isFuture ? <Badge tone="info">scheduled</Badge> : <Badge>ended</Badge>}
                </div>
                <div className="px-5 py-4">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Taxable income</Th>
                        <Th align="right">Marginal rate</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {set.rows.map((row, i) => (
                        <Tr key={i}>
                          <Td className="tnum">
                            {formatMoney(row.minCents)} – {row.maxCents !== null ? formatMoney(row.maxCents) : "and up"}
                          </Td>
                          <Td align="right" className="tnum font-medium">{formatRate(row.rateMicro)}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
