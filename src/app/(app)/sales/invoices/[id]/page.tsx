import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate, formatDateLong, formatDateTime, daysBetween, today } from "@/lib/dates";
import { formatMoney, formatQty, formatRate } from "@/lib/money";
import { taxRegistrationLines } from "@/lib/tax-registration";
import {
  Badge, Card, CardHeader, Money, PageHeader, StatusBadge, Table, Td, Th, Tr,
} from "@/components/ui";
import { InvoiceActions } from "./invoice-actions";

export default async function InvoiceDetailPage({ params }: PageProps<"/sales/invoices/[id]">) {
  const { company, role } = await requireCapability(CAPABILITIES.INVOICES);
  const currency = company.baseCurrency;
  const { id } = await params;

  const invoice = await db.invoice.findFirst({
    where: { id, companyId: company.id },
    include: {
      customer: true,
      project: true,
      lines: {
        orderBy: { lineNo: "asc" },
        include: { account: true, taxCode: { include: { components: true } }, item: true },
      },
      allocations: {
        include: { payment: true, creditNote: { select: { id: true, number: true } } },
        orderBy: { date: "asc" },
      },
      journalEntry: {
        include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } },
      },
    },
  });
  if (!invoice) notFound();

  const [bankAccounts, taxEntries, auditTrail, companyProfile] = await Promise.all([
    db.account.findMany({
      where: { companyId: company.id, subtype: { in: ["BANK"] }, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
    db.taxEntry.findMany({
      where: { companyId: company.id, sourceType: "INVOICE", sourceId: invoice.id },
      include: { taxCode: true },
    }),
    db.auditLog.findMany({
      where: { companyId: company.id, entityType: { in: ["Invoice", "JournalEntry"] }, entityId: { in: [invoice.id, invoice.journalEntryId ?? ""] } },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
      take: 10,
    }),
    db.company.findUniqueOrThrow({
      where: { id: company.id },
      select: { name: true, legalName: true, addressLine1: true, city: true, province: true, postalCode: true, gstNumber: true, qstNumber: true, pstNumber: true, email: true, phone: true, invoiceFooter: true },
    }),
  ]);

  const overdueDays = daysBetween(invoice.dueDate, today());
  const canPay = can(role, CAPABILITIES.PAYMENTS);

  /**
   * Addresses come off the document, not the customer — that is the point of
   * snapshotting them. Invoices raised before the snapshot columns existed have
   * none, so those fall back to the customer record rather than showing blanks.
   */
  const billTo = {
    name: invoice.billToName ?? invoice.customer.name,
    line1: invoice.billToLine1 ?? invoice.customer.addressLine1,
    line2: invoice.billToLine2 ?? invoice.customer.addressLine2,
    city: invoice.billToCity ?? invoice.customer.city,
    province: invoice.billToProvince ?? invoice.customer.province,
    postalCode: invoice.billToPostalCode ?? invoice.customer.postalCode,
  };

  const shipTo = invoice.shipToLine1 || invoice.shipToCity || invoice.shipToProvince
    ? {
        name: invoice.shipToName ?? invoice.customer.name,
        line1: invoice.shipToLine1,
        line2: invoice.shipToLine2,
        city: invoice.shipToCity,
        province: invoice.shipToProvince,
        postalCode: invoice.shipToPostalCode,
      }
    : null;

  const placeOfSupply = shipTo?.province ?? billTo.province ?? null;

  return (
    <>
      <PageHeader
        title={`Invoice ${invoice.number}`}
        breadcrumb={[{ label: "Sales", href: "/sales/invoices" }, { label: "Invoices", href: "/sales/invoices" }, { label: invoice.number }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={invoice.status} />
            {invoice.balanceCents > 0 && overdueDays > 0 && <Badge tone="negative">{overdueDays} days overdue</Badge>}
            {!invoice.journalEntryId && invoice.status !== "VOID" && (
              <Badge tone="neutral">Not posted — affects no report yet</Badge>
            )}
            <span className="text-muted-ink">
              {invoice.customer.name} · issued {formatDate(invoice.issueDate)} · due {formatDate(invoice.dueDate)}
            </span>
          </span>
        }
        actions={
          <InvoiceActions
            invoiceId={invoice.id}
            status={invoice.status}
            balanceCents={invoice.balanceCents}
            isPosted={Boolean(invoice.journalEntryId)}
            sentAt={invoice.sentAt?.toISOString() ?? null}
            bankAccounts={bankAccounts}
            canRecordPayment={canPay}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        {/* The document */}
        <Card className="print-full">
          <div className="flex flex-wrap items-start justify-between gap-6 border-b border-paper-200 pb-5">
            <div>
              <p className="text-[1.125rem] font-semibold tracking-[-0.01em] text-ink-950">{companyProfile.legalName ?? companyProfile.name}</p>
              <p className="mt-1 text-[0.8125rem] leading-6 text-muted-ink">
                {companyProfile.addressLine1}
                {companyProfile.addressLine1 && <br />}
                {[companyProfile.city, companyProfile.province, companyProfile.postalCode].filter(Boolean).join(", ")}
                {taxRegistrationLines(companyProfile).map((registration) => (
                  <span key={registration.label}>
                    <br />
                    {registration.label}: {registration.value}
                  </span>
                ))}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-maple-600">Invoice</p>
              <p className="tnum text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-950">{invoice.number}</p>
              <p className="mt-1 text-[0.8125rem] text-muted-ink">{formatDateLong(invoice.issueDate)}</p>
            </div>
          </div>

          <div className="grid gap-6 border-b border-paper-200 py-5 sm:grid-cols-3">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Bill to</p>
              <p className="mt-1 text-[0.9375rem] font-medium text-ink-900">{billTo.name}</p>
              <p className="text-[0.8125rem] leading-6 text-muted-ink">
                {addressBody(billTo)}
                {invoice.customer.email && (
                  <>
                    <br />
                    {invoice.customer.email}
                  </>
                )}
              </p>
            </div>
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Ship to</p>
              {shipTo ? (
                <>
                  <p className="mt-1 text-[0.9375rem] font-medium text-ink-900">{shipTo.name}</p>
                  <p className="text-[0.8125rem] leading-6 text-muted-ink">{addressBody(shipTo)}</p>
                </>
              ) : (
                <p className="mt-1 text-[0.8125rem] leading-6 text-muted-ink">Same as the billing address</p>
              )}
              {placeOfSupply && (
                <p className="mt-1.5 text-[0.75rem] text-muted-ink">
                  Place of supply: <span className="font-medium text-ink-800">{placeOfSupply}</span>
                </p>
              )}
            </div>
            <div className="sm:text-right">
              <dl className="space-y-1 text-[0.8125rem]">
                <div className="flex justify-between sm:justify-end sm:gap-6">
                  <dt className="text-muted-ink">Terms</dt>
                  <dd className="text-ink-800">{invoice.terms ?? `Net ${invoice.customer.paymentTermsDays}`}</dd>
                </div>
                <div className="flex justify-between sm:justify-end sm:gap-6">
                  <dt className="text-muted-ink">Due date</dt>
                  <dd className="text-ink-800">{formatDate(invoice.dueDate)}</dd>
                </div>
                {invoice.poNumber && (
                  <div className="flex justify-between sm:justify-end sm:gap-6">
                    <dt className="text-muted-ink">PO / reference</dt>
                    <dd className="text-ink-800">{invoice.poNumber}</dd>
                  </div>
                )}
                {invoice.project && (
                  <div className="flex justify-between sm:justify-end sm:gap-6">
                    <dt className="text-muted-ink">Project</dt>
                    <dd className="text-ink-800">{invoice.project.name}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>

          <Table className="mt-1">
            <thead>
              <tr>
                <Th>Description</Th>
                <Th width="5rem" align="right">Qty</Th>
                <Th width="7rem" align="right">Rate</Th>
                <Th width="6rem">Tax</Th>
                <Th width="8rem" align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <Tr key={line.id}>
                  <Td>
                    <span className="font-medium text-ink-900">{line.description}</span>
                    <span className="block text-[0.75rem] text-muted-ink">
                      {line.account.code} · {line.account.name}
                    </span>
                  </Td>
                  <Td align="right" className="tnum">{formatQty(line.quantityMilli)}</Td>
                  <Td align="right"><Money cents={line.unitPriceCents} /></Td>
                  <Td>
                    {line.taxCode ? (
                      <span className="text-[0.75rem] text-muted-ink" title={line.taxCode.name}>
                        {line.taxCode.code}
                      </span>
                    ) : (
                      <span className="text-[0.75rem] text-muted-ink">—</span>
                    )}
                  </Td>
                  <Td align="right"><Money cents={line.netCents} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>

          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-xs space-y-1.5 text-[0.8125rem]">
              <Row label="Subtotal" value={invoice.subtotalCents} currency={currency} />
              {invoice.discountCents > 0 && <Row label="Discount" value={-invoice.discountCents} currency={currency} />}
              {groupTax(taxEntries).map(([label, cents]) => (
                <Row key={label} label={label} value={cents} currency={currency} />
              ))}
              <div className="flex items-center justify-between border-t border-paper-300 pt-2 text-[0.9375rem] font-semibold">
                <dt className="text-ink-900">Total</dt>
                <dd className="tnum text-ink-950">{formatMoney(invoice.totalCents, { currency })}</dd>
              </div>
              {invoice.amountPaidCents > 0 && <Row label="Paid" value={-invoice.amountPaidCents} currency={currency} />}
              {invoice.writtenOffCents > 0 && <Row label="Written off" value={-invoice.writtenOffCents} currency={currency} />}
              <div className="flex items-center justify-between rounded-md bg-paper-100 px-2 py-1.5 text-[0.9375rem] font-semibold">
                <dt className="text-ink-900">Balance due</dt>
                <dd className="tnum text-ink-950">{formatMoney(invoice.balanceCents, { currency })}</dd>
              </div>
            </dl>
          </div>

          {(invoice.memo || companyProfile.invoiceFooter) && (
            <p className="mt-5 border-t border-paper-200 pt-4 text-[0.8125rem] leading-6 text-muted-ink">
              {invoice.memo}
              {companyProfile.invoiceFooter && (
                <>
                  <br />
                  {companyProfile.invoiceFooter}
                </>
              )}
            </p>
          )}
        </Card>

        {/* Rail: ledger trace, payments, tax, audit */}
        <div className="no-print space-y-4">
          <Card>
            <CardHeader
              title="Ledger entry"
              subtitle={invoice.journalEntry ? "What this invoice posted" : "Nothing posted yet"}
            />
            {invoice.journalEntry ? (
              <>
                <Link
                  href={`/accounting/journals/${invoice.journalEntry.id}`}
                  className="mt-3 flex items-center gap-2 text-[0.8125rem] font-medium text-brand-700 hover:underline"
                >
                  {invoice.journalEntry.entryNo}
                  <span className="text-muted-ink">· {formatDate(invoice.journalEntry.date)}</span>
                </Link>
                <ul className="mt-2 space-y-1 text-[0.75rem]">
                  {invoice.journalEntry.lines.map((line) => (
                    <li key={line.id} className="flex items-center gap-2">
                      <span className={line.debitCents > 0 ? "w-5 font-semibold text-info" : "w-5 font-semibold text-maple-600"}>
                        {line.debitCents > 0 ? "Dr" : "Cr"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-700">
                        {line.account.code} {line.account.name}
                      </span>
                      <Money cents={line.debitCents > 0 ? line.debitCents : line.creditCents} />
                    </li>
                  ))}
                </ul>
                <p className="mt-3 rounded bg-positive-soft px-2 py-1 text-[0.75rem] text-positive">
                  Debits {formatMoney(invoice.journalEntry.totalDebitCents, { currency })} = credits {formatMoney(invoice.journalEntry.totalCreditCents, { currency })}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
                This invoice is a draft. It appears in no report and has changed no account balance. Post it to
                create the journal entry.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Payments applied" subtitle={`${invoice.allocations.length} allocation(s)`} />
            {invoice.allocations.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-muted-ink">Nothing received against this invoice yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-paper-200">
                {invoice.allocations.map((allocation) => (
                  <li key={allocation.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink-900">
                        {allocation.payment?.number ?? allocation.creditNote?.number ?? "Write-off"}
                      </span>
                      <span className="text-[0.75rem] text-muted-ink">
                        {allocation.kind === "WRITE_OFF" ? "Bad debt" : allocation.kind === "CREDIT" ? "Credit note applied" : allocation.payment?.method}
                        {" · "}
                        {formatDate(allocation.date)}
                      </span>
                    </span>
                    <Money cents={allocation.amountCents} bold />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {taxEntries.length > 0 && (
            <Card>
              <CardHeader title="Tax detail" subtitle="Rates snapshotted at posting" />
              <ul className="mt-3 space-y-1.5 text-[0.8125rem]">
                {taxEntries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2">
                    <Badge tone="info">{entry.kind}</Badge>
                    <span className="flex-1 text-muted-ink">
                      {formatRate(entry.rateMicro)} on <Money cents={entry.taxableCents} />
                    </span>
                    <Money cents={entry.taxCents} bold />
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[0.75rem] leading-5 text-muted-ink">
                These rows feed Tax Summary and the GST/HST return, and reconcile to the tax control accounts.
              </p>
            </Card>
          )}

          <Card>
            <CardHeader title="History" />
            <ul className="mt-3 space-y-2.5">
              {auditTrail.map((event) => (
                <li key={event.id} className="flex gap-2.5 text-[0.75rem]">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" />
                  <span className="min-w-0">
                    <span className="block text-ink-800">{event.summary}</span>
                    <span className="text-muted-ink">
                      {event.user?.name ?? "System"} · {formatDateTime(event.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
              {auditTrail.length === 0 && <li className="text-[0.8125rem] text-muted-ink">No history recorded.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

/** The address body, one line per part, as it prints on the document. */
function addressBody(address: {
  line1: string | null;
  line2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
}) {
  return (
    <>
      {address.line1}
      {address.line1 && <br />}
      {address.line2}
      {address.line2 && <br />}
      {[address.city, address.province, address.postalCode].filter(Boolean).join(", ")}
    </>
  );
}

function groupTax(entries: { kind: string; rateMicro: number; taxCents: number }[]): [string, number][] {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const label = `${entry.kind} ${formatRate(entry.rateMicro)}`;
    map.set(label, (map.get(label) ?? 0) + entry.taxCents);
  }
  return [...map.entries()];
}

function Row({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="tnum text-ink-900">{formatMoney(value, { currency })}</dd>
    </div>
  );
}
