import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { formatRate } from "@/lib/money";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { PROVINCES } from "@/lib/enums";
import { currentRegionalTaxRate } from "@/server/tax/regional-rates";
import { AddProvinceCodes, TaxCodeRowActions } from "./tax-code-form";

export const metadata = { title: "Tax codes" };

export default async function TaxCodesPage() {
  const { company, role } = await requireCapability(CAPABILITIES.TAX_FILING);
  const editable = can(role, CAPABILITIES.TAX_SETTINGS);

  const codes = await db.taxCode.findMany({
    where: { companyId: company.id },
    include: { components: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ isActive: "desc" }, { code: "asc" }],
  });

  // "In use" is what makes a code un-editable: posted entries snapshot the rate.
  const usage = await db.taxEntry.groupBy({
    by: ["taxCodeId"],
    where: { companyId: company.id },
    _count: { _all: true },
  });
  const usedById = new Map(usage.map((u) => [u.taxCodeId, u._count._all]));

  // Reference table: the platform's rate in force today for every province.
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

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <Card className="p-5">
          <CardHeader
            title={`${company.province} tax codes`}
            subtitle={`${codes.filter((c) => c.isActive).length} active of ${codes.length}`}
          />

          {codes.length === 0 ? (
            <EmptyState
              title="No tax codes yet"
              description="Add the codes this company charges and pays before raising an invoice or entering a bill."
            />
          ) : (
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th width="14rem">Components</Th>
                  <Th width="6rem" align="right">Rate</Th>
                  <Th width="11rem">Effective</Th>
                  <Th width="7rem" align="right">Used</Th>
                  <Th width="9rem" />
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => {
                  const combined = code.components.reduce((sum, c) => sum + c.rateMicro, 0);
                  const used = usedById.get(code.id) ?? 0;
                  return (
                    <Tr key={code.id} className={code.isActive ? undefined : "opacity-60"}>
                      <Td>
                        <span className="font-medium text-ink-900">{code.code}</span>
                        <span className="block text-[0.75rem] text-muted-ink">{code.name}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {code.isDefaultSales && <Badge tone="accent">default sales</Badge>}
                          {code.isDefaultPurchase && <Badge tone="accent">default purchase</Badge>}
                          {code.isZeroRated && <Badge tone="info">zero-rated</Badge>}
                          {code.isExempt && <Badge tone="neutral">exempt</Badge>}
                          {!code.isActive && <Badge tone="neutral">archived</Badge>}
                        </span>
                      </Td>
                      <Td>
                        {code.components.length === 0 ? (
                          <span className="text-muted-ink">No tax charged</span>
                        ) : (
                          <span className="text-[0.75rem] leading-5 text-ink-700">
                            {code.components.map((component) => (
                              <span key={component.id} className="block">
                                {component.name} {formatRate(component.rateMicro)}
                                <span className="text-muted-ink">
                                  {component.isRecoverable ? " · recoverable" : " · not recoverable"}
                                  {component.compoundOnPrevious && " · compounded"}
                                </span>
                              </span>
                            ))}
                          </span>
                        )}
                      </Td>
                      <Td align="right" className="tnum font-medium text-ink-900">
                        {code.components.length === 0 ? "—" : formatRate(combined)}
                      </Td>
                      <Td>
                        <span className="text-[0.75rem] text-ink-700">
                          {formatDate(code.effectiveFrom)}
                          <span className="block text-muted-ink">
                            {code.effectiveTo ? `until ${formatDate(code.effectiveTo)}` : "no end date"}
                          </span>
                        </span>
                      </Td>
                      <Td align="right" className="tnum text-muted-ink">
                        {used === 0 ? "—" : used.toLocaleString("en-CA")}
                      </Td>
                      <Td>
                        {editable && (
                          <TaxCodeRowActions
                            taxCodeId={code.id}
                            code={code.code}
                            isActive={code.isActive}
                            hasEndDate={Boolean(code.effectiveTo)}
                            appliesToSales={code.appliesToSales}
                            appliesToPurchases={code.appliesToPurchases}
                            isDefaultSales={code.isDefaultSales}
                            isDefaultPurchase={code.isDefaultPurchase}
                          />
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}

          <p className="mt-4 text-[0.75rem] leading-5 text-muted-ink">
            Sales tax collected credits a liability control account; GST/HST and QST paid on purchases debit a
            recoverable account as an input tax credit. PST and RST are not recoverable — that tax stays in the expense,
            which is why those codes show no recoverable account.
          </p>
        </Card>

        {editable ? (
          <AddProvinceCodes homeProvince={company.province} />
        ) : (
          <Card>
            <CardHeader title="Read only" subtitle="Your role can view tax setup but not change it" />
            <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
              Changing a rate changes what every future document charges. Ask the primary user or the external
              accountant on this file to make the change.
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
