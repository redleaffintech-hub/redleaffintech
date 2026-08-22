import { db } from "@/lib/db";
import { requireCompany } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { closeChecklist } from "@/server/accounting/journals";
import { fiscalYearOf, today, formatDate, formatDateTime } from "@/lib/dates";
import { Badge, Callout, Card, CardHeader, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { PeriodActions, YearEndButton } from "./period-actions";

export const metadata = { title: "Fiscal periods" };

export default async function PeriodsPage({ searchParams }: PageProps<"/accounting/periods">) {
  const { company, role } = await requireCompany();
  const params = await searchParams;

  const fiscalYear = Number(
    typeof params.year === "string" ? params.year : fiscalYearOf(today(), company.fiscalYearStartMonth),
  );
  const canClose = can(role, CAPABILITIES.PERIOD_CLOSE);

  const periods = await db.fiscalPeriod.findMany({
    where: { companyId: company.id, fiscalYear },
    orderBy: { periodNumber: "asc" },
  });

  const [entryCounts, years] = await Promise.all([
    db.journalEntry.groupBy({
      by: ["fiscalPeriodId"],
      where: { companyId: company.id, fiscalPeriodId: { in: periods.map((p) => p.id) } },
      _count: true,
      _sum: { totalDebitCents: true },
    }),
    db.fiscalPeriod.findMany({
      where: { companyId: company.id },
      distinct: ["fiscalYear"],
      select: { fiscalYear: true },
      orderBy: { fiscalYear: "desc" },
    }),
  ]);
  const statsById = new Map(entryCounts.map((c) => [c.fiscalPeriodId, c]));

  // The next period that could be closed is the earliest open one.
  const nextToClose = periods.find((p) => p.status === "OPEN" && p.endDate < today());
  const checklist = nextToClose ? await closeChecklist(company.id, nextToClose.startDate, nextToClose.endDate) : [];

  const allClosed = periods.length > 0 && periods.every((p) => p.status !== "OPEN");

  return (
    <>
      <PageHeader
        title="Fiscal periods"
        breadcrumb={[{ label: "Accounting" }, { label: "Fiscal periods" }]}
        description={`Fiscal ${fiscalYear}. A closed period rejects postings from every source; a locked period cannot be reopened.`}
        actions={
          <div className="flex items-center gap-2">
            {years.map((y) => (
              <a
                key={y.fiscalYear}
                href={`/accounting/periods?year=${y.fiscalYear}`}
                className={`rounded-md px-2.5 py-1.5 text-[0.8125rem] font-medium ${
                  y.fiscalYear === fiscalYear ? "bg-ink-900 text-white" : "border border-paper-400 bg-white text-ink-700 hover:bg-paper-100"
                }`}
              >
                {y.fiscalYear}
              </a>
            ))}
          </div>
        }
      />

      {!canClose && (
        <div className="mb-4">
          <Callout tone="neutral" title="Read-only for your role">
            Closing and reopening a period is restricted to the Primary admin and the external accountant. You can
            still see the status of every period here.
          </Callout>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        <Card className="p-5">
          <CardHeader title="Periods" subtitle={`${periods.filter((p) => p.status === "OPEN").length} open`} />
          <Table className="mt-3">
            <thead>
              <tr>
                <Th width="3rem">#</Th>
                <Th>Period</Th>
                <Th width="12rem">Dates</Th>
                <Th width="5.5rem" align="right">Entries</Th>
                <Th width="9rem" align="right">Posted</Th>
                <Th width="7rem">Status</Th>
                <Th width="9rem" />
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => {
                const stats = statsById.get(period.id);
                return (
                  <Tr key={period.id}>
                    <Td className="tnum text-muted-ink">{period.periodNumber}</Td>
                    <Td className="font-medium text-ink-900">{period.name}</Td>
                    <Td className="text-muted-ink">
                      {formatDate(period.startDate)} – {formatDate(period.endDate)}
                    </Td>
                    <Td align="right" className="tnum text-muted-ink">{stats?._count ?? 0}</Td>
                    <Td align="right"><Money cents={stats?._sum.totalDebitCents ?? 0} blankZero /></Td>
                    <Td><StatusBadge status={period.status} /></Td>
                    <Td>
                      {canClose && (
                        <PeriodActions
                          periodId={period.id}
                          periodName={period.name}
                          status={period.status}
                          hasFutureOpen={periods.some((p) => p.periodNumber < period.periodNumber && p.status === "OPEN")}
                        />
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>

          {periods.some((p) => p.closedAt) && (
            <p className="mt-4 text-[0.75rem] text-muted-ink">
              Last close: {formatDateTime(periods.filter((p) => p.closedAt).sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime())[0].closedAt!)}.
              Every close and reopen is written to the audit log with the user who did it.
            </p>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Close checklist"
              subtitle={nextToClose ? `Before closing ${nextToClose.name}` : "Nothing waiting to close"}
            />
            {nextToClose ? (
              <ul className="mt-3 space-y-2.5">
                {checklist.map((item) => (
                  <li key={item.key} className="flex gap-2.5">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        item.status === "PASS" ? "bg-positive" : item.status === "WARN" ? "bg-caution" : "bg-negative"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block text-[0.8125rem] font-medium text-ink-900">{item.label}</span>
                      <span className="block text-[0.75rem] leading-5 text-muted-ink">{item.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[0.8125rem] text-muted-ink">
                Every past period in fiscal {fiscalYear} is already closed.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Year-end close" subtitle={`Fiscal ${fiscalYear}`} />
            <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
              The year-end close sweeps every revenue and expense balance into Retained Earnings, resets the income
              statement to zero for the new year, and locks all twelve periods.
            </p>
            <div className="mt-3">
              {canClose ? (
                <YearEndButton fiscalYear={fiscalYear} disabled={!allClosed} />
              ) : (
                <Badge>Requires Primary admin or accountant</Badge>
              )}
            </div>
            {!allClosed && (
              <p className="mt-2 text-[0.75rem] text-muted-ink">
                Close all twelve monthly periods first — the button unlocks once fiscal {fiscalYear} has no open periods.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
