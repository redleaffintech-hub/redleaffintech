import Link from "next/link";
import { listTaxPeriods } from "@/server/db/tax-periods";
import { listAllTaxEntries } from "@/server/db/tax-entries";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { addMonths, endOfMonth, formatDate, today } from "@/lib/dates";
import { Badge, Card, CardHeader, EmptyState, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { FilePeriodButton } from "../file-period-button";
import { DeletePeriodButton, GeneratePeriodsForm } from "./period-tools";

export const metadata = { title: "Filing periods" };

export default async function TaxPeriodsPage() {
  const { company, role } = await requireCapability(CAPABILITIES.TAX_FILING);
  const editable = can(role, CAPABILITIES.TAX_FILING);

  const [periods, entries] = await Promise.all([
    listTaxPeriods(company.id),
    listAllTaxEntries(company.id),
  ]);

  // One pass over the subledger gives every period its net figure, rather than
  // running the full return working paper once per row.
  const collectedById = new Map<string, number>();
  const recoverableById = new Map<string, number>();
  const countById = new Map<string, number>();
  for (const e of entries) {
    if (!e.taxPeriodId) continue;
    countById.set(e.taxPeriodId, (countById.get(e.taxPeriodId) ?? 0) + 1);
    if (e.direction === "SALE") {
      collectedById.set(e.taxPeriodId, (collectedById.get(e.taxPeriodId) ?? 0) + e.taxCents);
    } else if (e.direction === "PURCHASE") {
      recoverableById.set(e.taxPeriodId, (recoverableById.get(e.taxPeriodId) ?? 0) + e.recoverableCents);
    }
  }

  const current = periods.find((period) => period.startDate <= today() && period.endDate >= today());
  const overdue = periods.filter(
    (period) => period.status !== "FILED" && period.status !== "CLOSED" && endOfMonth(addMonths(period.endDate, 1)) < today(),
  );

  return (
    <>
      <PageHeader
        title="Filing periods"
        breadcrumb={[{ label: "Tax Centre", href: "/tax" }, { label: "Filing periods" }]}
        description="Each period collects the tax entries dated inside it. A return is prepared, filed, then locked — the working paper stays readable afterwards."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <Card className="p-5">
          <CardHeader
            title="All periods"
            subtitle={current ? `Current period: ${current.name}` : "No period covers today"}
            action={overdue.length > 0 ? <Badge tone="negative">{overdue.length} past due</Badge> : undefined}
          />

          {periods.length === 0 ? (
            <EmptyState
              title="No filing periods"
              description="Open a year of periods so tax entries have somewhere to land and returns can be tracked."
            />
          ) : (
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th width="11rem">Covering</Th>
                  <Th width="8rem" align="right">Net tax</Th>
                  <Th width="9rem">Filing</Th>
                  <Th width="7rem">Status</Th>
                  <Th width="14rem" />
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => {
                  const netCents =
                    period.status === "FILED" || period.status === "CLOSED"
                      ? (period.netFiledCents ??
                        (collectedById.get(period.id) ?? 0) - (recoverableById.get(period.id) ?? 0))
                      : (collectedById.get(period.id) ?? 0) - (recoverableById.get(period.id) ?? 0);
                  const dueDate = endOfMonth(addMonths(period.endDate, 1));
                  const isPastDue = period.status !== "FILED" && period.status !== "CLOSED" && dueDate < today();

                  return (
                    <Tr key={period.id}>
                      <Td>
                        <Link href={`/tax?period=${period.id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                          {period.name}
                        </Link>
                        <span className="block text-[0.75rem] text-muted-ink">
                          {period.frequency.toLowerCase()} filer · {countById.get(period.id) ?? 0} tax entries
                        </span>
                      </Td>
                      <Td className="text-[0.75rem] text-ink-700">
                        {formatDate(period.startDate)} – {formatDate(period.endDate)}
                        <span className={isPastDue ? "block text-negative" : "block text-muted-ink"}>
                          due {formatDate(dueDate)}
                        </span>
                      </Td>
                      <Td align="right">
                        <Money cents={netCents} bold />
                        <span className="block text-[0.75rem] text-muted-ink">
                          {netCents >= 0 ? "payable" : "refund"}
                        </span>
                      </Td>
                      <Td className="text-[0.75rem] text-ink-700">
                        {period.filedAt ? (
                          <>
                            {formatDate(period.filedAt)}
                            <span className="block text-muted-ink">{period.filingReference || "no reference"}</span>
                          </>
                        ) : (
                          <span className="text-muted-ink">—</span>
                        )}
                      </Td>
                      <Td><StatusBadge status={period.status} /></Td>
                      <Td>
                        <div className="flex items-center justify-end gap-2">
                          {editable && period.status !== "CLOSED" && (
                            <FilePeriodButton
                              periodId={period.id}
                              periodName={period.name}
                              status={period.status}
                              netCents={netCents}
                            />
                          )}
                          {editable && period.status === "OPEN" && (countById.get(period.id) ?? 0) === 0 && (
                            <DeletePeriodButton periodId={period.id} periodName={period.name} />
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          {editable && <GeneratePeriodsForm defaultYear={today().getUTCFullYear()} />}

          <Card>
            <CardHeader title="How the due date is worked out" />
            <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
              The date shown is the end of the month following the period end, which is the common GST/HST filing
              deadline for monthly and quarterly filers. Annual filers, and anyone with instalment obligations, have
              different dates — confirm yours with the CRA or your accountant rather than relying on this column.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
