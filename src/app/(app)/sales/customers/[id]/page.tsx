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

export default async function CustomerDetailPage({ params, searchParams }: PageProps<"/sales/customers/[id]">) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const currency = company.baseCurrency;
  const { id } = await params;
  const search = await searchParams;

  const customer = await db.customer.findFirst({
    where: { id, companyId: company.id },
    include: { taxCode: true, contacts: true },
  });
  if (!customer) notFound();

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof search.from === "string" ? search.from : isoDate(defaults.start));
  const to = toUtcDay(typeof search.to === "string" ? search.to : isoDate(today()));

  const [statement, invoices, payments] = await Promise.all([
    partyStatement(company.id, { customerId: customer.id }, from, to),
    db.invoice.findMany({
      where: { companyId: company.id, customerId: customer.id },
      orderBy: { issueDate: "desc" },
      take: 25,
    }),
    db.payment.findMany({
      where: { companyId: company.id, customerId: customer.id, status: "POSTED" },
      orderBy: { date: "desc" },
      take: 10,
    }),
  ]);

  const outstandingCents = invoices.reduce((s, i) => s + i.balanceCents, 0);
  const lifetimeCents = invoices
    .filter((i) => i.status !== "VOID" && i.status !== "DRAFT")
    .reduce((s, i) => s + i.totalCents, 0);
  const unappliedCents = payments.reduce((s, p) => s + p.unappliedCents, 0);

  return (
    <>
      <PageHeader
        title={customer.name}
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Customers", href: "/sales/customers" },
          { label: customer.name },
        ]}
        description={`Net ${customer.paymentTermsDays} terms · default tax ${customer.taxCode?.code ?? "none"}`}
        actions={
          <>
            <PrintButton label="Print statement" />
            <ExportCsvButton report="customer-statement" params={{ party: customer.id }} />
            <LinkButton href="/sales/invoices/new" variant="primary">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New invoice
            </LinkButton>
          </>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Outstanding balance" value={outstandingCents} emphasis currency={currency} />
        <Stat label="Billed to date" value={lifetimeCents} currency={currency} />
        <Stat label="Unapplied credit" value={unappliedCents} currency={currency} />
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
            title="Invoices"
            hrefBase="/sales/invoices"
            documents={invoices.map((i) => ({
              id: i.id,
              number: i.number,
              date: i.issueDate,
              dueDate: i.dueDate,
              totalCents: i.totalCents,
              balanceCents: i.balanceCents,
              status: i.status,
            }))}
          />
        </div>

        <div className="no-print space-y-4">
          <Card>
            <CardHeader title="Details" />
            <div className="mt-3">
              <DefinitionList
                items={[
                  { label: "Email", value: customer.email ?? "—" },
                  { label: "Phone", value: customer.phone ?? "—" },
                  {
                    label: "Address",
                    value: [customer.addressLine1, customer.city, customer.province, customer.postalCode]
                      .filter(Boolean)
                      .join(", ") || "—",
                  },
                  { label: "Payment terms", value: `Net ${customer.paymentTermsDays}` },
                  { label: "Default tax code", value: customer.taxCode ? `${customer.taxCode.code} — ${customer.taxCode.name}` : "—" },
                  { label: "Status", value: customer.isActive ? "Active" : "Archived" },
                ]}
              />
            </div>
            {customer.notes && (
              <p className="mt-3 border-t border-paper-200 pt-3 text-[0.8125rem] leading-6 text-muted-ink">
                {customer.notes}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Recent receipts" />
            {payments.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-muted-ink">No payments received yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-paper-200">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink-900">{payment.number}</span>
                      <span className="text-[0.75rem] text-muted-ink">
                        {formatDate(payment.date)} · {payment.method}
                        {payment.unappliedCents > 0 && ` · ${formatMoney(payment.unappliedCents, { currency })} unapplied`}
                      </span>
                    </span>
                    <Money cents={payment.amountCents} bold />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, emphasis, currency }: { label: string; value: number; emphasis?: boolean; currency: string }) {
  return (
    <div className={`rounded-[--radius-card] border bg-white p-4 ${emphasis ? "border-ink-900/15" : "border-paper-300"}`}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className="tnum mt-1 text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-950">{formatMoney(value, { currency })}</p>
    </div>
  );
}
