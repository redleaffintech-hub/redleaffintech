import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { partyStatement } from "@/server/reports/aging";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, CardHeader, DefinitionList, LinkButton, Money, PageHeader } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { DocumentList, PartyStatement } from "@/components/party-views";
import { Icon } from "@/components/shell/icons";

export default async function VendorDetailPage({ params, searchParams }: PageProps<"/purchases/vendors/[id]">) {
  const { company } = await requireCapability(CAPABILITIES.BILLS);
  const currency = company.baseCurrency;
  const { id } = await params;
  const search = await searchParams;

  const vendor = await db.vendor.findFirst({
    where: { id, companyId: company.id },
    include: { taxCode: true },
  });
  if (!vendor) notFound();

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof search.from === "string" ? search.from : isoDate(defaults.start));
  const to = toUtcDay(typeof search.to === "string" ? search.to : isoDate(today()));

  const [statement, bills, payments, expenses] = await Promise.all([
    partyStatement(company.id, { vendorId: vendor.id }, from, to),
    db.bill.findMany({ where: { companyId: company.id, vendorId: vendor.id }, orderBy: { issueDate: "desc" }, take: 25 }),
    db.payment.findMany({ where: { companyId: company.id, vendorId: vendor.id, status: "POSTED" }, orderBy: { date: "desc" }, take: 10 }),
    db.expense.findMany({ where: { companyId: company.id, vendorId: vendor.id }, orderBy: { date: "desc" }, take: 8 }),
  ]);

  const owingCents = bills.reduce((s, b) => s + b.balanceCents, 0);
  const spentCents =
    bills.filter((b) => b.status !== "VOID" && b.status !== "DRAFT").reduce((s, b) => s + b.totalCents, 0) +
    expenses.filter((e) => e.status === "POSTED").reduce((s, e) => s + e.totalCents, 0);

  return (
    <>
      <PageHeader
        title={vendor.name}
        breadcrumb={[
          { label: "Purchases", href: "/purchases/bills" },
          { label: "Vendors", href: "/purchases/vendors" },
          { label: vendor.name },
        ]}
        description={`Net ${vendor.paymentTermsDays} terms · default tax ${vendor.taxCode?.code ?? "none"}`}
        actions={
          <>
            <PrintButton label="Print statement" />
            <ExportCsvButton report="vendor-statement" params={{ party: vendor.id }} />
            <LinkButton href={`/purchases/vendors/${vendor.id}/edit`}>Edit vendor</LinkButton>
            <LinkButton href="/purchases/bills/new" variant="primary">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New bill
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Balance owing" value={owingCents} emphasis currency={currency} />
        <Stat label="Spent to date" value={spentCents} currency={currency} />
        <Stat label="Open bills" value={bills.filter((b) => b.balanceCents > 0).length} plain currency={currency} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_19rem] lg:items-start">
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-center gap-2">
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
          </div>

          <div>
            <h2 className="mb-2 text-[0.9375rem] font-semibold text-ink-900">
              Statement · {formatDate(from)} to {formatDate(to)}
            </h2>
            <PartyStatement
              openingCents={statement.openingCents}
              closingCents={statement.closingCents}
              from={from}
              to={to}
              rows={statement.rows.map((row) => ({
                id: row.id,
                date: row.date,
                entryNo: row.journalEntry.entryNo,
                journalEntryId: row.journalEntryId,
                reference: row.journalEntry.sourceNumber,
                description: row.description ?? row.journalEntry.memo,
                movementCents: row.movementCents,
                runningBalanceCents: row.runningBalanceCents,
              }))}
            />
          </div>

          <DocumentList
            title="Bills"
            hrefBase="/purchases/bills"
            documents={bills.map((b) => ({
              id: b.id,
              number: b.number,
              date: b.issueDate,
              dueDate: b.dueDate,
              totalCents: b.totalCents,
              balanceCents: b.balanceCents,
              status: b.status,
            }))}
          />
        </div>

        <div className="no-print space-y-4">
          <Card>
            <CardHeader
              title="Details"
              action={
                <Link
                  href={`/purchases/vendors/${vendor.id}/edit`}
                  className="text-[0.75rem] font-medium text-brand-700 hover:underline"
                >
                  Edit
                </Link>
              }
            />
            <div className="mt-3">
              <DefinitionList
                items={[
                  { label: "Email", value: vendor.email ?? "—" },
                  { label: "Phone", value: vendor.phone ?? "—" },
                  { label: "Business number", value: vendor.businessNumber ?? "—" },
                  { label: "Payment terms", value: `Net ${vendor.paymentTermsDays}` },
                  { label: "Default tax code", value: vendor.taxCode ? `${vendor.taxCode.code} — ${vendor.taxCode.name}` : "—" },
                  { label: "Status", value: vendor.isActive ? "Active" : "Archived" },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent payments" />
            {payments.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-muted-ink">No payments made yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-paper-200">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink-900">{payment.number}</span>
                      <span className="text-[0.75rem] text-muted-ink">
                        {formatDate(payment.date)} · {payment.method}
                      </span>
                    </span>
                    <Money cents={payment.amountCents} bold />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {expenses.length > 0 && (
            <Card>
              <CardHeader title="Direct expenses" subtitle="Paid without a bill" />
              <ul className="mt-3 divide-y divide-paper-200">
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink-900">{expense.number}</span>
                      <span className="text-[0.75rem] text-muted-ink">{formatDate(expense.date)}</span>
                    </span>
                    <Money cents={expense.totalCents} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, emphasis, plain, currency }: { label: string; value: number; emphasis?: boolean; plain?: boolean; currency: string }) {
  return (
    <div className={`rounded-[--radius-card] border bg-white p-4 ${emphasis ? "border-ink-900/15" : "border-paper-300"}`}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className="tnum mt-1 text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-950">
        {plain ? value : formatMoney(value, { currency })}
      </p>
    </div>
  );
}
