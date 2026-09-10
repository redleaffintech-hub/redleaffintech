import Link from "next/link";
import { listTaxPeriods } from "@/server/db/tax-periods";
import { listTaxCodes } from "@/server/db/tax-codes";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { taxPeriodReturn } from "@/server/reports/tax";
import { addMonths, endOfMonth, formatDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { taxRegistrationLines } from "@/lib/tax-registration";
import { Badge, Callout, Card, CardHeader, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { FilePeriodButton } from "./file-period-button";

export const metadata = { title: "Tax Centre" };

export default async function TaxCentrePage({ searchParams }: PageProps<"/tax">) {
  const { company, role } = await requireCapability(CAPABILITIES.TAX_FILING);
  const currency = company.baseCurrency;
  const registrations = taxRegistrationLines(company);
  const params = await searchParams;

  const periods = (await listTaxPeriods(company.id)).slice(0, 12);

  const selectedId =
    typeof params.period === "string"
      ? params.period
      : (periods.find((p) => p.startDate <= today() && p.endDate >= today()) ?? periods[0])?.id;

  const selected = periods.find((p) => p.id === selectedId);
  const result = selected ? await taxPeriodReturn(company.id, selected.id) : null;
  const dueDate = selected ? endOfMonth(addMonths(selected.endDate, 1)) : null;

  const taxCodes = await listTaxCodes(company.id, { activeOnly: true });

  return (
    <>
      <PageHeader
        title="Tax Centre"
        description={`GST/HST and provincial sales tax for ${company.name} (${company.province})${registrations.map((r) => ` · ${r.label} ${r.value}`).join("")}.`}
        actions={
          <>
            <LinkButton href="/reports/tax-detail">Transaction detail</LinkButton>
            <LinkButton href="/tax/codes">Tax codes</LinkButton>
          </>
        }
      />

      {!result ? (
        <Callout tone="caution" title="No filing periods configured">
          Create tax periods so remittances can be tracked and reconciled.
        </Callout>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
          <div className="space-y-4">
            <Card className="p-5">
              <CardHeader
                title={`Return working paper — ${selected!.name}`}
                subtitle={`${formatDate(selected!.startDate)} to ${formatDate(selected!.endDate)} · ${selected!.frequency.toLowerCase()} filer`}
                action={<StatusBadge status={selected!.status} />}
              />

              <dl className="mt-5 divide-y divide-paper-200">
                <ReturnLine
                  currency={currency}
                  line="101"
                  label="Sales and other revenue"
                  hint="Total supplies made in the period, including zero-rated and exempt."
                  value={result.line101SuppliesCents}
                />
                <ReturnLine
                  currency={currency}
                  line="105"
                  label="GST/HST and adjustments collected"
                  hint="Tax charged on invoices, bank deposits and other taxable sales."
                  value={result.line105CollectedCents}
                />
                <ReturnLine
                  currency={currency}
                  line="108"
                  label="Input tax credits (ITCs)"
                  hint="Recoverable tax paid on bills and expenses. Non-recoverable PST is excluded."
                  value={result.line108ItcCents}
                />
                <ReturnLine
                  currency={currency}
                  line="109"
                  label={result.line109NetCents >= 0 ? "Net tax payable" : "Net tax refundable"}
                  hint="Line 105 less line 108."
                  value={Math.abs(result.line109NetCents)}
                  emphasis
                />
              </dl>

              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-paper-300 pt-4">
                <span className="text-[0.8125rem] text-muted-ink">
                  Filing due {dueDate ? formatDate(dueDate) : "—"}
                  {dueDate && ` · ${Math.round((dueDate.getTime() - today().getTime()) / 86_400_000)} days`}
                </span>
                {can(role, CAPABILITIES.TAX_FILING) && selected!.status !== "CLOSED" && (
                  <FilePeriodButton
                    periodId={selected!.id}
                    periodName={selected!.name}
                    status={selected!.status}
                    netCents={result.line109NetCents}
                  />
                )}
              </div>
            </Card>

            <Card className="p-5">
              <CardHeader
                title="Reconciliation to the ledger"
                subtitle="The tax subledger against the tax control accounts"
                action={
                  <Badge tone={result.summary.reconciliation.reconciled ? "positive" : "negative"}>
                    {result.summary.reconciliation.reconciled ? "reconciled" : "mismatch"}
                  </Badge>
                }
              />
              <Table className="mt-3">
                <thead>
                  <tr>
                    <Th>Control account</Th>
                    <Th width="10rem" align="right">Movement in period</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.summary.reconciliation.accounts.map((account) => (
                    <Tr key={account.id}>
                      <Td>
                        <Link href={`/accounting/general-ledger?account=${account.id}`} className="hover:text-brand-700 hover:underline">
                          <span className="tnum mr-2 text-[0.75rem] text-muted-ink">{account.code}</span>
                          {account.name}
                        </Link>
                      </Td>
                      <Td align="right"><Money cents={account.movementCents} blankZero /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
                Tax collected per the subledger {formatMoney(result.summary.reconciliation.subledgerCollected, { currency })} vs the
                general ledger {formatMoney(result.summary.reconciliation.glCollected, { currency })}. A difference means tax was
                posted by manual journal without a matching tax entry — find it before you file.
              </p>
            </Card>

            <Card className="p-5">
              <CardHeader title="By tax code" subtitle="What makes up the return" />
              <Table className="mt-3">
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th width="9rem" align="right">Taxable sales</Th>
                    <Th width="9rem" align="right">Collected</Th>
                    <Th width="9rem" align="right">ITCs</Th>
                    <Th width="9rem" align="right">Net</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.summary.rows.map((row) => (
                    <Tr key={`${row.kind}-${row.taxCode}`}>
                      <Td>
                        <span className="font-medium text-ink-900">{row.taxCode}</span>
                        <span className="block text-[0.75rem] text-muted-ink">{row.taxCodeName}</span>
                      </Td>
                      <Td align="right"><Money cents={row.salesTaxableCents} blankZero /></Td>
                      <Td align="right"><Money cents={row.taxCollectedCents} blankZero /></Td>
                      <Td align="right"><Money cents={row.recoverableCents} blankZero /></Td>
                      <Td align="right"><Money cents={row.netCents} bold /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Filing periods" action={<LinkButton href="/tax/periods">All</LinkButton>} />
              <ul className="mt-3 space-y-1">
                {periods.slice(0, 8).map((period) => (
                  <li key={period.id}>
                    <Link
                      href={`/tax?period=${period.id}`}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] transition-colors ${
                        period.id === selectedId ? "bg-brand-soft font-medium text-ink-900" : "text-ink-700 hover:bg-paper-100"
                      }`}
                    >
                      <span className="flex-1">{period.name}</span>
                      <StatusBadge status={period.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Active tax codes" action={<LinkButton href="/tax/codes">Manage</LinkButton>} />
              <ul className="mt-3 space-y-2">
                {taxCodes.slice(0, 8).map((code) => (
                  <li key={code.id} className="text-[0.8125rem]">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-ink-900">{code.code}</span>
                      <span className="flex-1 truncate text-muted-ink">{code.name}</span>
                    </span>
                    {code.components.length > 0 && (
                      <span className="block text-[0.75rem] text-muted-ink">
                        {code.components.map((c) => `${c.name} ${(c.rateMicro / 10_000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`).join(" + ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Professional boundary" />
              <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
                These figures are a working paper, not a filed return. Canadian rates and obligations vary by province,
                registration status and transaction type, and place-of-supply rules can change which rate applies. Have
                a qualified Canadian CPA review the tax setup and this working paper before filing.
              </p>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

function ReturnLine({
  line,
  label,
  hint,
  value,
  emphasis,
  currency,
}: {
  line: string;
  label: string;
  hint: string;
  value: number;
  emphasis?: boolean;
  currency: string;
}) {
  return (
    <div className={`flex items-start gap-4 py-3 ${emphasis ? "bg-paper-100 -mx-2 px-2 rounded-md" : ""}`}>
      <span className="tnum w-10 shrink-0 rounded bg-ink-900 px-1.5 py-0.5 text-center text-[0.6875rem] font-semibold text-white">
        {line}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[0.875rem] ${emphasis ? "font-semibold text-ink-950" : "font-medium text-ink-900"}`}>
          {label}
        </span>
        <span className="block text-[0.75rem] leading-5 text-muted-ink">{hint}</span>
      </span>
      <span className={`tnum shrink-0 ${emphasis ? "text-[1.125rem] font-semibold text-ink-950" : "text-[0.9375rem] text-ink-900"}`}>
        {formatMoney(value, { currency })}
      </span>
    </div>
  );
}
