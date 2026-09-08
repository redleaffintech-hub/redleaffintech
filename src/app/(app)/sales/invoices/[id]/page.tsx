import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate, formatDateLong, formatDateTime, daysBetween, today } from "@/lib/dates";
import { formatMoney, formatQty, formatRate } from "@/lib/money";
import { taxRegistrationLines } from "@/lib/tax-registration";
import { Badge, Card, CardHeader, Money, PageHeader, StatusBadge } from "@/components/ui";
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
      where: { companyId: company.id, subtype: { in: ["BANK", "CASH"] }, isActive: true },
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
      select: { name: true, legalName: true, addressLine1: true, addressLine2: true, city: true, province: true, postalCode: true, businessNumber: true, gstNumber: true, qstNumber: true, pstNumber: true, email: true, phone: true, website: true, invoiceFooter: true, logoUrl: true },
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

  const fmt = (cents: number) => formatMoney(cents, { currency });

  /** Header detail rows — optional ones drop out when they hold nothing. */
  const detailRows: { label: string; value: string }[] = [
    { label: "Invoice #", value: invoice.number },
    { label: "Invoice date", value: formatDateLong(invoice.issueDate) },
    { label: "Due date", value: formatDate(invoice.dueDate) },
    { label: "Terms", value: invoice.terms ?? `Net ${invoice.customer.paymentTermsDays}` },
  ];
  if (invoice.poNumber) detailRows.push({ label: "PO / reference", value: invoice.poNumber });
  if (invoice.project) detailRows.push({ label: "Project", value: invoice.project.name });

  const companyAddress = [
    companyProfile.addressLine1,
    companyProfile.addressLine2,
    [companyProfile.city, companyProfile.province, companyProfile.postalCode].filter(Boolean).join(", ") || null,
  ].filter(Boolean).join(", ");
  const footerContact = [
    companyProfile.email,
    companyProfile.phone,
    companyProfile.website,
    companyAddress || null,
  ].filter(Boolean) as string[];

  const hasItemColumn = invoice.lines.some((line) => line.item);

  // Editable while nothing is owed against it: a draft is rewritten, a posted
  // invoice is reversed and re-posted under the same number.
  const canEdit =
    invoice.status !== "VOID" && invoice.allocations.length === 0 && invoice.amountPaidCents === 0;

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
            canEdit={canEdit}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        {/* The document */}
        <Card className="invoice-paper print-full">
          {/* Letterhead — company at left, red Invoice mark and details at right */}
          <div className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[color:var(--inv-accent)] pb-4">
            <div className="flex items-start gap-3">
              {companyProfile.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimizable remote asset
                <img src={companyProfile.logoUrl} alt="" className="h-14 w-14 rounded object-contain" />
              )}
              <div>
                <p className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
                  {companyProfile.legalName ?? companyProfile.name}
                </p>
                <p className="mt-1 text-[0.8125rem] leading-6 text-[color:var(--inv-ink)]/75">
                  {companyProfile.addressLine1}
                  {companyProfile.addressLine1 && <br />}
                  {companyProfile.addressLine2}
                  {companyProfile.addressLine2 && <br />}
                  {[companyProfile.city, companyProfile.province, companyProfile.postalCode].filter(Boolean).join(", ")}
                  {companyProfile.businessNumber && (
                    <>
                      <br />
                      Business no.: {companyProfile.businessNumber}
                    </>
                  )}
                  {taxRegistrationLines(companyProfile).map((registration) => (
                    <span key={registration.label}>
                      <br />
                      {registration.label}: {registration.value}
                    </span>
                  ))}
                </p>
              </div>
            </div>
            <div className="min-w-[15rem] text-right">
              <p className="inv-accent text-[1.75rem] font-bold uppercase tracking-[0.02em]">Invoice</p>
              <table className="mt-2 ml-auto text-[0.8125rem]">
                <tbody>
                  {detailRows.map((row) => (
                    <tr key={row.label}>
                      <td className="py-0.5 pr-3 text-left text-[color:var(--inv-ink)]/70">{row.label}</td>
                      <td className="tnum py-0.5 text-right font-medium">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bill to / Ship to, side by side */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="inv-keep">
              <div className="inv-band">Bill to</div>
              <div className="inv-box text-[0.8125rem] leading-6">
                <p className="font-medium">{billTo.name}</p>
                <p>{addressBody(billTo)}</p>
                {invoice.customer.email && <p>{invoice.customer.email}</p>}
              </div>
            </div>
            <div className="inv-keep">
              <div className="inv-band">Ship to</div>
              <div className="inv-box text-[0.8125rem] leading-6">
                <p className="font-medium">{(shipTo ?? billTo).name}</p>
                <p>{addressBody(shipTo ?? billTo)}</p>
                {placeOfSupply && (
                  <p className="mt-1 text-[0.6875rem] text-[color:var(--inv-ink)]/60">
                    Place of supply: <span className="font-medium">{placeOfSupply}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Lines */}
          <div className="inv-scroll mt-5">
            <table className="inv-table min-w-[36rem]">
              <thead>
                <tr>
                  {hasItemColumn && <th className="w-24">Item #</th>}
                  <th>Description</th>
                  <th className="inv-num w-20">Qty</th>
                  <th className="inv-num w-28">Unit price</th>
                  <th className="inv-num w-28">Line total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((line) => (
                  <tr key={line.id}>
                    {hasItemColumn && <td className="tnum">{line.item?.code ?? ""}</td>}
                    <td>
                      <span className="font-medium">{line.description}</span>
                      <span className="mt-0.5 block text-[0.6875rem] text-[color:var(--inv-ink)]/60">
                        {line.account.code} · {line.account.name}
                        {line.taxCode && ` · ${line.taxCode.code}`}
                        {line.discountPercentMicro > 0 && ` · ${formatRate(line.discountPercentMicro / 100)} off`}
                      </span>
                    </td>
                    <td className="inv-num tnum">{formatQty(line.quantityMilli)}</td>
                    <td className="inv-num tnum">{fmt(line.unitPriceCents)}</td>
                    <td className="inv-num tnum">{fmt(line.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Notes at left, tax breakdown and totals at right */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="inv-keep">
              {invoice.memo && (
                <>
                  <div className="inv-band">Notes</div>
                  <div className="inv-box whitespace-pre-line text-[0.8125rem] leading-6">{invoice.memo}</div>
                </>
              )}
            </div>
            <div className="inv-keep">
              <table className="inv-totals ml-auto max-w-xs text-[0.8125rem]">
                <tbody>
                  <tr>
                    <td className="text-[color:var(--inv-ink)]/75">Subtotal</td>
                    <td className="tnum">{fmt(invoice.subtotalCents)}</td>
                  </tr>
                  {invoice.discountCents > 0 && (
                    <tr>
                      <td className="text-[color:var(--inv-ink)]/75">Discount</td>
                      <td className="tnum">{fmt(-invoice.discountCents)}</td>
                    </tr>
                  )}
                  {groupTax(taxEntries).map(([label, cents]) => (
                    <tr key={label}>
                      <td className="text-[color:var(--inv-ink)]/75">{label}</td>
                      <td className="tnum">{fmt(cents)}</td>
                    </tr>
                  ))}
                  <tr className="inv-grand">
                    <td>Total</td>
                    <td className="tnum">{fmt(invoice.totalCents)}</td>
                  </tr>
                  {invoice.amountPaidCents > 0 && (
                    <tr>
                      <td className="text-[color:var(--inv-ink)]/75">Paid</td>
                      <td className="tnum">{fmt(-invoice.amountPaidCents)}</td>
                    </tr>
                  )}
                  {invoice.writtenOffCents > 0 && (
                    <tr>
                      <td className="text-[color:var(--inv-ink)]/75">Written off</td>
                      <td className="tnum">{fmt(-invoice.writtenOffCents)}</td>
                    </tr>
                  )}
                  <tr className="inv-due">
                    <td>Balance due</td>
                    <td className="tnum">{fmt(invoice.balanceCents)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer — payment instructions and contact details */}
          {(companyProfile.invoiceFooter || footerContact.length > 0) && (
            <div className="inv-footer">
              {companyProfile.invoiceFooter && (
                <p className="whitespace-pre-line">
                  <span className="font-semibold">Payment instructions.</span> {companyProfile.invoiceFooter}
                </p>
              )}
              {footerContact.length > 0 && (
                <p className={companyProfile.invoiceFooter ? "mt-1.5" : ""}>
                  <span className="font-semibold">{companyProfile.legalName ?? companyProfile.name}</span>
                  {" — "}
                  {footerContact.join("  ·  ")}
                </p>
              )}
            </div>
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
