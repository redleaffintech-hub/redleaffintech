import Link from "next/link";
import { requireCompany } from "@/server/auth/context";
import { dashboardData } from "@/server/reports/dashboard";
import { formatDate, formatDateLong } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { SOURCE_LABELS } from "@/lib/enums";
import { AgingBar, GroupedBarChart, Sparkline, TrendChart } from "@/components/charts";
import { Badge, Button, Card, CardHeader, LinkButton, Money, PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { company, user, role } = await requireCompany();
  const currency = company.baseCurrency;
  const data = await dashboardData(company.id);

  const firstName = user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName}`}
        description={
          <>
            {company.name} · fiscal {data.fiscalYear} · figures as at {formatDateLong(data.asOf)}. Every total on
            this page is aggregated from posted journal entries.
          </>
        }
        actions={
          <>
            <LinkButton href="/reports">View all reports</LinkButton>
            <LinkButton href="/sales/invoices/new" variant="primary">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New invoice
            </LinkButton>
          </>
        }
      />

      {/* Attention strip */}
      <ActionStrip data={data} currency={currency} />

      {/* KPI row */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          currency={currency}
          label="Cash on hand"
          value={data.kpis.cashOnHandCents}
          caption={
            data.kpis.creditCardOwingCents > 0
              ? `${formatMoney(data.kpis.creditCardOwingCents, { currency })} owing on cards`
              : "Across all bank & cash accounts"
          }
          spark={data.cashTrend.map((p) => p.value)}
          href="/banking/accounts"
        />
        <StatTile
          currency={currency}
          label="Revenue year to date"
          value={data.kpis.revenueCents}
          delta={delta(data.kpis.revenueCents, data.kpis.priorRevenueCents)}
          caption="vs same point last fiscal year"
          sparkColor="var(--color-series-4)"
          spark={data.performance.map((p) => p.a)}
          href="/reports/profit-and-loss"
        />
        <StatTile
          currency={currency}
          label="Expenses year to date"
          value={data.kpis.expenseCents}
          delta={delta(data.kpis.expenseCents, data.kpis.priorExpenseCents)}
          invertDelta
          caption="vs same point last fiscal year"
          sparkColor="var(--color-series-2)"
          spark={data.performance.map((p) => p.b)}
          href="/reports/profit-and-loss"
        />
        <StatTile
          currency={currency}
          label="Net income year to date"
          value={data.kpis.netIncomeCents}
          delta={delta(data.kpis.netIncomeCents, data.kpis.priorNetIncomeCents)}
          caption={`${data.kpis.grossMarginPercent.toFixed(1)}% gross margin`}
          href="/reports/profit-and-loss"
          emphasis
        />
      </div>

      {/* Charts */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="Cash position"
            subtitle="Closing balance of every bank and cash account, month by month"
            action={<LinkButton href="/reports/cash-flow">Cash flow statement</LinkButton>}
          />
          <div className="mt-4">
            <TrendChart points={data.cashTrend} height={218} seriesLabel="Cash on hand" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Revenue vs expenses" subtitle={`Fiscal ${data.fiscalYear} to date, posted amounts`} />
          <div className="mt-2">
            <GroupedBarChart points={data.performance} height={228} />
          </div>
        </Card>
      </div>

      {/* Receivables / payables / tax */}
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Accounts receivable"
            subtitle={`${formatMoney(data.ar.totalCents, { currency })} outstanding`}
            action={<LinkButton href="/reports/ar-aging">Aging</LinkButton>}
          />
          <div className="mt-4">
            <AgingBar buckets={data.ar.buckets} total={data.ar.totalCents} />
          </div>
          {data.ar.overdueCents > 0 && (
            <p className="mt-3 rounded-md bg-negative-soft px-2.5 py-1.5 text-[0.8125rem] text-negative">
              <Money cents={data.ar.overdueCents} bold showCurrency currency={currency} /> is past due.
            </p>
          )}
          <TopParties title="Largest balances" rows={data.ar.top} hrefBase="/sales/customers" />
        </Card>

        <Card>
          <CardHeader
            title="Accounts payable"
            subtitle={`${formatMoney(data.ap.totalCents, { currency })} owing`}
            action={<LinkButton href="/reports/ap-aging">Aging</LinkButton>}
          />
          <div className="mt-4">
            <AgingBar buckets={data.ap.buckets} total={data.ap.totalCents} />
          </div>
          {data.ap.dueSoonCents > 0 && (
            <p className="mt-3 rounded-md bg-caution-soft px-2.5 py-1.5 text-[0.8125rem] text-caution">
              <Money cents={data.ap.dueSoonCents} bold showCurrency currency={currency} /> falls due in the next 7 days.
            </p>
          )}
          <TopParties title="Largest balances" rows={data.ap.top} hrefBase="/purchases/vendors" />
        </Card>

        <Card>
          <CardHeader
            title="Sales tax position"
            subtitle={data.tax ? data.tax.periodName : "No filing period configured"}
            action={<LinkButton href="/tax">Tax Centre</LinkButton>}
          />
          {data.tax ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-paper-300 bg-paper-100 p-4">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                  Net tax {data.tax.netCents >= 0 ? "payable" : "refundable"}
                </p>
                <p className="tnum mt-1 text-[1.75rem] font-semibold leading-9 tracking-[-0.02em] text-ink-950">
                  {formatMoney(Math.abs(data.tax.netCents), { currency })}
                </p>
                <p className="mt-1 text-[0.75rem] text-muted-ink">
                  {data.tax.daysUntilDue >= 0
                    ? `Due ${formatDate(data.tax.dueDate)} — ${data.tax.daysUntilDue} days`
                    : `Was due ${formatDate(data.tax.dueDate)}`}
                </p>
              </div>
              <dl className="space-y-1.5 text-[0.8125rem]">
                <Row label="Tax collected on sales" value={data.tax.collectedCents} />
                <Row label="Input tax credits claimed" value={-data.tax.recoverableCents} />
                <Row label="Net remittance" value={data.tax.netCents} bold />
              </dl>
              <div className="flex items-center gap-2 pt-1">
                <StatusBadge status={data.tax.status} />
                <Badge tone={data.tax.reconciled ? "positive" : "negative"}>
                  {data.tax.reconciled ? "Reconciled to GL" : "GL mismatch"}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-[0.8125rem] text-muted-ink">
              Set up filing periods in Tax Centre to track GST/HST remittances.
            </p>
          )}
        </Card>
      </div>

      {/* Activity + period close */}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader
              title="Recent postings"
              subtitle="The last entries to hit the general ledger"
              action={<LinkButton href="/accounting/journals">Journal report</LinkButton>}
            />
          </div>
          <ul className="divide-y divide-paper-200">
            {data.recentEntries.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/accounting/journals/${entry.id}`}
                  className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-paper-100"
                >
                  <span className="w-[4.5rem] shrink-0 text-[0.75rem] text-muted-ink">{formatDate(entry.date)}</span>
                  <span className="tnum w-[5.5rem] shrink-0 text-[0.8125rem] font-medium text-ink-900">{entry.entryNo}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] text-ink-800">{entry.memo}</span>
                    <span className="text-[0.75rem] text-muted-ink">
                      {SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}
                      {entry.sourceNumber ? ` · ${entry.sourceNumber}` : ""}
                    </span>
                  </span>
                  {entry.status === "REVERSED" && <StatusBadge status="REVERSED" />}
                  <Money cents={entry.totalDebitCents} className="shrink-0 text-[0.8125rem] font-medium" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title={`Fiscal ${data.fiscalYear} periods`}
            subtitle="Close each month once it is reconciled"
            action={<LinkButton href="/accounting/periods">Manage</LinkButton>}
          />
          <ul className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-3">
            {data.periods.map((period) => {
              const tone =
                period.status === "LOCKED"
                  ? "border-[color:var(--color-negative)]/25 bg-negative-soft text-negative"
                  : period.status === "CLOSED"
                    ? "border-paper-400 bg-paper-200 text-ink-700"
                    : "border-[color:var(--color-positive)]/25 bg-positive-soft text-positive";
              return (
                <li
                  key={period.id}
                  className={`rounded-md border px-2 py-1.5 text-center text-[0.75rem] font-medium ${tone}`}
                  title={`${period.name} — ${period.status.toLowerCase()}`}
                >
                  {period.name.split(" ")[0].slice(0, 3)}
                  <span className="mt-0.5 block text-[0.625rem] font-normal uppercase tracking-[0.04em] opacity-80">
                    {period.status === "OPEN" ? "open" : period.status === "CLOSED" ? "closed" : "locked"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[0.75rem] leading-5 text-muted-ink">
            A closed period rejects new postings from every source — invoices, bills, banking and manual
            journals alike. Only a Primary admin or the external accountant can reopen one, and both the
            close and the reopen are written to the audit log.
          </p>
          {role === "SECONDARY" && (
            <p className="mt-2 rounded-md bg-paper-100 px-2.5 py-1.5 text-[0.75rem] text-muted-ink">
              Your bookkeeper role can post into open periods but cannot close or reopen them.
            </p>
          )}
        </Card>
      </div>

      <p className="mt-8 text-[0.75rem] leading-5 text-muted-ink">
        Red Leaf Accounting is accounting software, not tax advice. Canadian rates and filing obligations vary by
        province, registration status and transaction type — have a qualified CPA validate your tax setup,
        chart of accounts and year-end before filing.
      </p>
    </>
  );
}

function ActionStrip({ data, currency }: { data: Awaited<ReturnType<typeof dashboardData>>; currency: string }) {
  const items = [
    data.bankQueue > 0 && {
      tone: "caution" as const,
      icon: "bank",
      label: `${data.bankQueue} bank transaction${data.bankQueue === 1 ? "" : "s"} to review`,
      href: "/banking",
      cta: "Open queue",
    },
    data.ar.overdueCents > 0 && {
      tone: "negative" as const,
      icon: "warning",
      label: `${formatMoney(data.ar.overdueCents, { currency })} in overdue invoices`,
      href: "/sales/invoices?status=OVERDUE",
      cta: "Chase",
    },
    data.tax &&
      data.tax.daysUntilDue <= 45 &&
      data.tax.status !== "FILED" && {
        tone: "info" as const,
        icon: "leaf",
        label: `${data.tax.periodName} return due in ${data.tax.daysUntilDue} days`,
        href: "/tax",
        cta: "Prepare",
      },
    !data.ar.reconciled && {
      tone: "negative" as const,
      icon: "warning",
      label: "A/R subledger does not match the control account",
      href: "/reports/ar-aging",
      cta: "Investigate",
    },
  ].filter(Boolean) as { tone: "caution" | "negative" | "info"; icon: string; label: string; href: string; cta: string }[];

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-[color:var(--color-positive)]/25 bg-positive-soft px-4 py-2.5 text-[0.8125rem] text-positive">
        <Icon name="check" className="h-4 w-4" />
        Nothing needs attention — the bank queue is clear, nothing is overdue and the subledgers tie to the ledger.
      </div>
    );
  }

  const styles = {
    caution: "border-[color:var(--color-caution)]/30 bg-caution-soft text-caution",
    negative: "border-[color:var(--color-negative)]/25 bg-negative-soft text-negative",
    info: "border-[color:var(--color-info)]/25 bg-info-soft text-info",
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-[0.8125rem] font-medium transition-transform hover:-translate-y-px ${styles[item.tone]}`}
        >
          <Icon name={item.icon} className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <Icon name="chevron" className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Link>
      ))}
    </div>
  );
}

function StatTile({
  label,
  value,
  caption,
  delta: change,
  invertDelta,
  spark,
  sparkColor,
  href,
  emphasis,
  currency,
}: {
  label: string;
  value: number;
  currency: string;
  caption?: string;
  delta?: number | null;
  invertDelta?: boolean;
  spark?: number[];
  sparkColor?: string;
  href?: string;
  emphasis?: boolean;
}) {
  const good = change === null || change === undefined ? null : invertDelta ? change <= 0 : change >= 0;

  const body = (
    <div
      className={`h-full rounded-[--radius-card] border bg-white p-4 shadow-[0_1px_2px_rgba(10,16,32,0.04)] transition-shadow hover:shadow-[0_8px_24px_-14px_rgba(10,16,32,0.35)] ${
        emphasis ? "border-ink-900/15 ring-1 ring-inset ring-ink-900/5" : "border-paper-300"
      }`}
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className="tnum text-[1.625rem] font-semibold leading-8 tracking-[-0.025em] text-ink-950">
          {formatMoney(value, { accountingNegative: true, currency })}
        </p>
        {spark && spark.length > 1 && <Sparkline values={spark} color={sparkColor} />}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {change !== null && change !== undefined && Number.isFinite(change) && (
          <span
            className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[0.75rem] font-medium ${
              good ? "bg-positive-soft text-positive" : "bg-negative-soft text-negative"
            }`}
          >
            <Icon name={change >= 0 ? "arrowUp" : "arrowDown"} className="h-3 w-3" />
            {Math.abs(change).toFixed(1)}%
          </span>
        )}
        {caption && <span className="truncate text-[0.75rem] text-muted-ink">{caption}</span>}
      </div>
    </div>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}

function TopParties({
  title,
  rows,
  hrefBase,
}: {
  title: string;
  rows: { partyId: string; partyName: string; totalCents: number; oldestDays: number }[];
  hrefBase: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 border-t border-paper-200 pt-3">
      <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.partyId}>
            <Link
              href={`${hrefBase}/${row.partyId}`}
              className="flex items-center gap-2 rounded px-1 py-1 text-[0.8125rem] transition-colors hover:bg-paper-100"
            >
              <span className="min-w-0 flex-1 truncate text-ink-800">{row.partyName}</span>
              {row.oldestDays > 0 && (
                <span className="shrink-0 text-[0.6875rem] text-muted-ink">{row.oldestDays}d</span>
              )}
              <Money cents={row.totalCents} className="shrink-0 font-medium" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "border-t border-paper-300 pt-1.5 font-semibold" : ""}`}>
      <dt className="text-ink-700">{label}</dt>
      <dd>
        <Money cents={value} bold={bold} />
      </dd>
    </div>
  );
}

function delta(current: number, prior: number): number | null {
  if (!prior) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}
