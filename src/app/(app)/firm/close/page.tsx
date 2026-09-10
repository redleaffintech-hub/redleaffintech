import { listFiscalPeriods } from "@/server/db/fiscal-periods";
import { closeChecklist, requireFirmClient } from "@/server/firm/portfolio";
import { formatDate } from "@/lib/dates";
import { Badge, Callout, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { ClosePeriodButton, ClosePicker, OpenClient } from "../firm-client";

export const metadata = { title: "Close checklist" };

export default async function FirmClosePage({ searchParams }: PageProps<"/firm/close">) {
  const params = await searchParams;
  const requestedClient = typeof params.client === "string" ? params.client : undefined;
  const requestedPeriod = typeof params.period === "string" ? params.period : undefined;

  const { client, clients } = await requireFirmClient(requestedClient);

  const periods = (await listFiscalPeriods(client.id))
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.periodNumber - a.periodNumber)
    .slice(0, 24)
    .map((p) => ({ id: p.id, name: p.name, status: p.status }));

  const checklist = await closeChecklist(client.id, requestedPeriod);
  const failing = checklist?.checks.filter((check) => check.state === "fail") ?? [];

  return (
    <>
      <PageHeader
        title="Close checklist"
        breadcrumb={[{ label: "Firm workspace", href: "/firm" }, { label: "Close checklist" }]}
        description="What has to be true before a period is closed. Each line runs the same reconciliation the report itself performs, so a green checklist and clean statements can never disagree."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ClosePicker
          clients={clients.map((c) => ({ id: c.id, name: c.name }))}
          periods={periods}
          activeClient={client.id}
          activePeriod={checklist?.period.id ?? ""}
        />
        <OpenClient companyId={client.id} href="/accounting/periods" variant="button">
          Open {client.name}
        </OpenClient>
      </div>

      {!checklist ? (
        <Card className="p-5">
          <EmptyState
            title="Nothing to close"
            description={`Every finished period on ${client.name} is already closed, or the fiscal calendar has not been created yet.`}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
          <Card className="p-5">
            <CardHeader
              title={checklist.period.name}
              subtitle={`${formatDate(checklist.period.startDate)} – ${formatDate(checklist.period.endDate)} · fiscal ${checklist.period.fiscalYear}`}
              action={<StatusBadge status={checklist.period.status} />}
            />

            <ul className="mt-4 divide-y divide-paper-200">
              {checklist.checks.map((check) => (
                <li key={check.key} className="flex items-start gap-3 py-3">
                  <span
                    className={
                      check.state === "pass"
                        ? "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-positive-soft text-positive"
                        : check.state === "fail"
                          ? "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-negative-soft text-negative"
                          : "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-caution-soft text-caution"
                    }
                  >
                    <Icon name={check.state === "pass" ? "check" : check.state === "fail" ? "x" : "warning"} className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.875rem] font-medium text-ink-900">{check.label}</span>
                    <span className="block text-[0.8125rem] leading-5 text-muted-ink">{check.detail}</span>
                  </span>
                  {check.href && check.state !== "pass" && (
                    <OpenClient companyId={client.id} href={check.href} variant="button">
                      Review
                    </OpenClient>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Ready to close?" />
              {checklist.period.status !== "OPEN" ? (
                <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
                  {checklist.period.name} is already {checklist.period.status.toLowerCase()}. Reopening is done from the
                  client&rsquo;s own fiscal periods screen, and the reason is written to their audit log.
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
                    {checklist.readyToClose
                      ? "Every check passes. Closing stops new postings landing in the period; it can still be reopened with a reason."
                      : `${failing.length} check${failing.length === 1 ? "" : "s"} still failing. Closing over an unreconciled subledger just moves the problem into next month.`}
                  </p>
                  <div className="mt-3 flex justify-end">
                    <ClosePeriodButton
                      companyId={client.id}
                      periodId={checklist.period.id}
                      periodName={checklist.period.name}
                      readyToClose={checklist.readyToClose}
                    />
                  </div>
                </>
              )}
            </Card>

            {failing.length > 0 && (
              <Callout tone="negative" title="Blocking issues">
                <ul className="mt-1 space-y-1">
                  {failing.map((check) => (
                    <li key={check.key}>· {check.label}</li>
                  ))}
                </ul>
              </Callout>
            )}

            <Card>
              <CardHeader title="What closing does" />
              <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
                A closed period rejects new postings dated inside it, for every document type at once — invoices, bills,
                bank categorisations and manual journals alike. Adjustments after the close go into the next open period
                or, with a reason recorded, into a reopened one.
              </p>
            </Card>

            <Card>
              <CardHeader title="Attention items" />
              <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
                Amber lines are judgement calls rather than blockers. A balance sitting in an uncategorised account will
                not stop a close, but it will misstate the income statement until someone decides where it belongs.
              </p>
              <div className="mt-2">
                <Badge tone="caution">attention</Badge>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
