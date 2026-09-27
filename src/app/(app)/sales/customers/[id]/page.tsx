import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { getCompanyProfile } from "@/server/companies/profile";
import { CAPABILITIES } from "@/lib/permissions";
import { partyStatement } from "@/server/reports/aging";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, CardHeader, DefinitionList, LinkButton, PageHeader } from "@/components/ui";
import { RangePicker, PrintButton } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { DocumentList, PartyStatement } from "@/components/party-views";
import { Icon } from "@/components/shell/icons";
import { CustomerReceipts } from "./customer-receipts";

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

  const [statement, invoices, payments, companyProfile, nextOpenInvoice, invoiceTotals, unappliedTotal] = await Promise.all([
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
    getCompanyProfile(company.id),
    db.invoice.findFirst({
      where: {
        companyId: company.id,
        customerId: customer.id,
        status: { notIn: ["DRAFT", "VOID"] },
        balanceCents: { gt: 0 },
      },
      orderBy: { dueDate: "asc" },
      select: { dueDate: true },
    }),
    // Uncapped (issue 7) — the lists above are capped at 25/10 rows for
    // display, so summing them under-counts a customer with more history
    // than that. These aggregate over every invoice/receipt regardless.
    db.invoice.aggregate({
      where: { companyId: company.id, customerId: customer.id, status: { notIn: ["DRAFT", "VOID"] } },
      _sum: { balanceCents: true, totalCents: true },
    }),
    db.payment.aggregate({
      where: { companyId: company.id, customerId: customer.id, status: "POSTED" },
      _sum: { unappliedCents: true },
    }),
  ]);

  const outstandingCents = invoiceTotals._sum.balanceCents ?? 0;
  const lifetimeCents = invoiceTotals._sum.totalCents ?? 0;
  const unappliedCents = unappliedTotal._sum.unappliedCents ?? 0;

  // Account summary, derived from the same statement rows so it can never
  // disagree with the transaction table or the closing balance.
  const newChargesCents = statement.rows.reduce((s, r) => s + Math.max(0, r.movementCents), 0);
  const creditsCents = statement.rows.reduce((s, r) => s + Math.max(0, -r.movementCents), 0);

  const companyAddressLines = [
    companyProfile.addressLine1,
    companyProfile.addressLine2,
    [companyProfile.city, companyProfile.province, companyProfile.postalCode].filter(Boolean).join(", ") || null,
  ].filter(Boolean) as string[];

  const billToLines = [
    customer.addressLine1,
    customer.addressLine2,
    [customer.city, customer.province, customer.postalCode].filter(Boolean).join(", ") || null,
  ].filter(Boolean) as string[];

  const paymentDueDate = statement.closingCents > 0 ? nextOpenInvoice?.dueDate ?? null : null;

  const statementMessage =
    statement.closingCents > 0
      ? `A balance of ${formatMoney(statement.closingCents, { currency })} is due on this account.${
          paymentDueDate ? ` Please remit payment by ${formatDate(paymentDueDate)}.` : " Please remit payment at your earliest convenience."
        }`
      : statement.closingCents < 0
        ? `Your account carries a credit balance of ${formatMoney(-statement.closingCents, { currency })}.`
        : "Your account is fully paid. No payment is due at this time.";

  const statementDocument = {
    currency,
    company: {
      name: companyProfile.legalName ?? companyProfile.name,
      addressLines: companyAddressLines,
      email: companyProfile.email,
      phone: companyProfile.phone,
      website: companyProfile.website,
    },
    billTo: {
      name: customer.name,
      lines: billToLines,
      email: customer.email,
      phone: customer.phone,
    },
    statementNumber: `STMT-${isoDate(to).replace(/-/g, "")}`,
    statementDate: to,
    // The customer's human-readable display code (issue 9), not the internal
    // cuid — a code that hasn't been backfilled yet falls back to the id so
    // the statement still prints something rather than a blank field.
    customerRef: customer.displayCode ?? customer.id,
    paymentDueDate,
    summary: {
      previousBalanceCents: statement.openingCents,
      creditsCents,
      newChargesCents,
      totalDueCents: statement.closingCents,
    },
    message: statementMessage,
  };

  return (
    <>
      <PageHeader
        title={customer.name}
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Customers", href: "/sales/customers" },
          { label: customer.name },
        ]}
        description={
          `${customer.displayCode ? `${customer.displayCode} · ` : ""}` +
          `Net ${customer.paymentTermsDays} terms · default tax ${customer.taxCode?.code ?? "none"}`
        }
        actions={
          <span className="no-print flex flex-wrap items-center gap-2">
            <PrintButton label="Print statement" />
            <ExportCsvButton report="customer-statement" params={{ party: customer.id }} />
            <LinkButton href={`/sales/customers/${customer.id}/edit`}>Edit customer</LinkButton>
            <LinkButton href={`/sales/invoices/new?customerId=${customer.id}`} variant="primary">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New invoice
            </LinkButton>
          </span>
        }
      />

      <div className="no-print mb-4 grid gap-4 sm:grid-cols-4">
        <Stat label="Gross open invoices" value={outstandingCents} emphasis currency={currency} />
        <Stat label="Unapplied credit" value={unappliedCents} currency={currency} />
        <Stat
          label="Net account balance"
          value={statement.closingCents}
          currency={currency}
          hint="Open invoices minus unapplied credit — netting these never settles an invoice by itself."
        />
        <Stat label="Billed to date" value={lifetimeCents} currency={currency} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_19rem] lg:items-start">
        <div className="space-y-4">
          <div className="no-print flex flex-wrap items-center gap-2">
            <RangePicker from={isoDate(from)} to={isoDate(to)} />
          </div>

          <PartyStatement
            openingCents={statement.openingCents}
            closingCents={statement.closingCents}
            from={from}
            to={to}
            document={statementDocument}
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

          <div className="no-print">
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
        </div>

        <div className="no-print space-y-4">
          <Card>
            <CardHeader
              title="Details"
              action={
                <Link
                  href={`/sales/customers/${customer.id}/edit`}
                  className="text-[0.75rem] font-medium text-brand-700 hover:underline"
                >
                  Edit
                </Link>
              }
            />
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
            <CustomerReceipts
              customerId={customer.id}
              payments={payments.map((p) => ({
                id: p.id,
                number: p.number,
                date: p.date.toISOString(),
                method: p.method,
                amountCents: p.amountCents,
                unappliedCents: p.unappliedCents,
              }))}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  emphasis,
  currency,
  hint,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
  currency: string;
  hint?: string;
}) {
  return (
    <div className={`rounded-[--radius-card] border bg-white p-4 ${emphasis ? "border-ink-900/15" : "border-paper-300"}`}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className="tnum mt-1 text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-950">{formatMoney(value, { currency })}</p>
      {hint && <p className="mt-1 text-[0.6875rem] leading-4 text-muted-ink">{hint}</p>}
    </div>
  );
}
