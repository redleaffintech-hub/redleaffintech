"use client";

import clsx from "clsx";
import { formatQty, formatRate } from "@/lib/money";
import { taxRegistrationLines } from "@/lib/tax-registration";
import { useMoney } from "@/components/currency-context";
import { formatDateLong, formatDate } from "@/lib/dates";
import { Table, Td, Th, Tr } from "@/components/ui";
import { AddressLines, isAddressEmpty, type DocumentAddress } from "@/components/document-address";
import type { computeDocument } from "@/server/documents/lines";

export interface PreviewCompany {
  name: string;
  legalName: string | null;
  addressLine1: string | null;
  addressLine2?: string | null;
  city: string | null;
  province: string;
  postalCode: string | null;
  businessNumber?: string | null;
  gstNumber: string | null;
  qstNumber: string | null;
  pstNumber: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  invoiceFooter: string | null;
  logoUrl?: string | null;
}

type Computed = ReturnType<typeof computeDocument>;

interface DocumentPreviewProps {
  title: string;
  number: string;
  company: PreviewCompany;
  billTo: DocumentAddress;
  shipTo: DocumentAddress | null;
  issueDate: string;
  secondDateLabel: string | null;
  secondDate: string | null;
  reference: string;
  referenceLabel: string;
  memo: string;
  accountName: (accountId: string) => string;
  computed: Computed;
  /**
   * "invoice" renders the client's blue-grey sales-invoice template; "standard"
   * (the default) is the plain layout every other document kind still uses.
   */
  variant?: "standard" | "invoice";
  /** Catalogue code for a line's linked item, for the invoice template's Item # column. */
  itemNumber?: (itemId: string) => string | null;
  /**
   * For a document that carries no addresses of ours (bill, credit note): the
   * label for the single party column, replacing the "Bill to" / "Ship to" pair.
   */
  partyHeading?: string;
}

/**
 * The document as it will read once saved — the last look before anything is
 * posted to the ledger.
 *
 * The totals are not recalculated here. They are the same `computeDocument`
 * result the editor is already showing, which is the same function the posting
 * engine runs on the server, so the preview cannot flatter the numbers.
 */
export function DocumentPreview(props: DocumentPreviewProps) {
  if (props.variant === "invoice") return <InvoiceDocument {...props} />;
  return <StandardDocument {...props} />;
}

// ── The client's sales-invoice template ─────────────────────────────────────

function InvoiceDocument({
  title,
  number,
  company,
  billTo,
  shipTo,
  issueDate,
  secondDateLabel,
  secondDate,
  reference,
  referenceLabel,
  memo,
  accountName,
  computed,
  itemNumber,
}: DocumentPreviewProps) {
  const money = useMoney();
  const issued = new Date(`${issueDate}T00:00:00.000Z`);
  const shipAddress = shipTo && !isAddressEmpty(shipTo) ? shipTo : billTo;

  const details: { label: string; value: string }[] = [
    { label: "Invoice #", value: number || "—" },
    { label: "Invoice date", value: formatDateLong(issued) },
  ];
  if (secondDateLabel && secondDate) {
    details.push({ label: secondDateLabel, value: formatDate(new Date(`${secondDate}T00:00:00.000Z`)) });
  }
  if (reference) details.push({ label: referenceLabel, value: reference });

  // Item numbers resolved once, parallel to computed.lines. The whole column is
  // dropped when no line is linked to a catalogue item.
  const itemCodes = computed.lines.map((line) =>
    itemNumber && line.itemId ? itemNumber(line.itemId) : null,
  );
  const hasItemColumn = itemCodes.some(Boolean);

  return (
    <div className="invoice-paper print-full">
      <InvoiceLetterhead company={company} title={title} details={details} />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <InvoiceParty heading="Bill to" address={billTo} />
        <InvoiceParty heading="Ship to" address={shipAddress} />
      </div>

      <div className="inv-scroll mt-5">
        {computed.lines.length === 0 ? (
          <p className="py-6 text-center text-[0.8125rem] text-[color:var(--inv-ink)]/60">
            No priced lines yet — go back and add an amount.
          </p>
        ) : (
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
              {computed.lines.map((line, index) => (
                <tr key={line.lineNo}>
                  {hasItemColumn && <td className="tnum">{itemCodes[index] ?? ""}</td>}
                  <td>
                    <span className="font-medium">{line.description}</span>
                    <span className="mt-0.5 block text-[0.6875rem] text-[color:var(--inv-ink)]/60">
                      {accountName(line.accountId)}
                      {line.discountPercentMicro > 0 &&
                        ` · ${formatRate(line.discountPercentMicro / 100)} off`}
                    </span>
                  </td>
                  <td className="inv-num tnum">{formatQty(line.quantityMilli)}</td>
                  <td className="inv-num tnum">{money.format(line.unitPriceCents)}</td>
                  <td className="inv-num tnum">{money.format(line.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="inv-keep">
          {memo ? (
            <>
              <div className="inv-band">Notes</div>
              <div className="inv-box whitespace-pre-line">{memo}</div>
            </>
          ) : null}
        </div>
        <div className="inv-keep">
          <InvoiceTotals
            rows={[
              { label: "Subtotal", value: computed.subtotalCents },
              ...(computed.discountCents > 0
                ? [{ label: "Discount", value: -computed.discountCents }]
                : []),
              ...computed.taxByComponent
                .filter((component) => component.taxCents !== 0)
                .map((component) => ({
                  label: `${component.name} ${formatRate(component.rateMicro)}`,
                  value: component.taxCents,
                })),
            ]}
            grand={{ label: "Total", value: computed.totalCents }}
          />
        </div>
      </div>

      <InvoiceFooter company={company} />
    </div>
  );
}

function InvoiceLetterhead({
  company,
  title,
  details,
}: {
  company: PreviewCompany;
  title: string;
  details: { label: string; value: string }[];
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[color:var(--inv-accent)] pb-4">
      <div className="flex items-start gap-3">
        {company.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimizable remote asset
          <img src={company.logoUrl} alt="" className="h-14 w-14 rounded object-contain" />
        )}
        <div>
          <p className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
            {company.legalName ?? company.name}
          </p>
          <p className="mt-1 text-[0.8125rem] leading-6 text-[color:var(--inv-ink)]/75">
            {company.addressLine1}
            {company.addressLine1 && <br />}
            {company.addressLine2}
            {company.addressLine2 && <br />}
            {[company.city, company.province, company.postalCode].filter(Boolean).join(", ")}
            {company.businessNumber && (
              <>
                <br />
                Business no.: {company.businessNumber}
              </>
            )}
            {taxRegistrationLines(company).map((registration) => (
              <span key={registration.label}>
                <br />
                {registration.label}: {registration.value}
              </span>
            ))}
          </p>
        </div>
      </div>
      <div className="min-w-[15rem] text-right">
        <p className="inv-accent text-[1.75rem] font-bold uppercase tracking-[0.02em]">
          {title || "Invoice"}
        </p>
        <table className="mt-2 ml-auto text-[0.8125rem]">
          <tbody>
            {details.map((row) => (
              <tr key={row.label}>
                <td className="pr-3 py-0.5 text-left text-[color:var(--inv-ink)]/70">{row.label}</td>
                <td className="py-0.5 text-right font-medium tnum">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceParty({ heading, address }: { heading: string; address: DocumentAddress }) {
  return (
    <div className="inv-keep">
      <div className="inv-band">{heading}</div>
      <div className="inv-box text-[0.8125rem] leading-6">
        <AddressLines address={address} />
      </div>
    </div>
  );
}

/** Totals grid: plain `rows`, then the highlighted `grand` row. */
function InvoiceTotals({
  rows,
  grand,
}: {
  rows: { label: string; value: number }[];
  grand: { label: string; value: number };
}) {
  const money = useMoney();
  return (
    <table className="inv-totals ml-auto max-w-xs text-[0.8125rem]">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="text-[color:var(--inv-ink)]/75">{row.label}</td>
            <td className="tnum">{money.format(row.value)}</td>
          </tr>
        ))}
        <tr className="inv-grand">
          <td>{grand.label}</td>
          <td className="tnum">{money.format(grand.value)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Payment instructions and contact details, hidden entirely when a company has neither. */
function InvoiceFooter({ company }: { company: PreviewCompany }) {
  const contact = [
    company.email,
    company.phone,
    company.website,
    [company.addressLine1, company.city, company.province, company.postalCode].filter(Boolean).join(", ") || null,
  ].filter(Boolean) as string[];

  if (!company.invoiceFooter && contact.length === 0) return null;

  return (
    <div className="inv-footer">
      {company.invoiceFooter && (
        <p className="whitespace-pre-line">
          <span className="font-semibold">Payment instructions.</span> {company.invoiceFooter}
        </p>
      )}
      {contact.length > 0 && (
        <p className={company.invoiceFooter ? "mt-1.5" : ""}>
          <span className="font-semibold">{company.legalName ?? company.name}</span>
          {" — "}
          {contact.join("  ·  ")}
        </p>
      )}
    </div>
  );
}

// ── The plain layout, unchanged, still used by quotes, credit notes and bills ─

function StandardDocument({
  title,
  number,
  company,
  billTo,
  shipTo,
  issueDate,
  secondDateLabel,
  secondDate,
  reference,
  referenceLabel,
  memo,
  accountName,
  computed,
  partyHeading,
}: DocumentPreviewProps) {
  const money = useMoney();
  const issued = new Date(`${issueDate}T00:00:00.000Z`);

  return (
    <div className="print-full">
      {/* Letterhead */}
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-paper-200 pb-4">
        <div>
          {company.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimizable remote asset
            <img src={company.logoUrl} alt="" className="mb-2 h-12 w-12 rounded object-contain" />
          )}
          <div>
            <p className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-950">
              {company.legalName ?? company.name}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-6 text-muted-ink">
              {company.addressLine1}
              {company.addressLine1 && <br />}
              {[company.city, company.province, company.postalCode].filter(Boolean).join(", ")}
              {taxRegistrationLines(company).map((registration) => (
                <span key={registration.label}>
                  <br />
                  {registration.label}: {registration.value}
                </span>
              ))}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-maple-600">{title}</p>
          <p className="tnum text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">{number || "—"}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-ink">{formatDateLong(issued)}</p>
        </div>
      </div>

      {/* Parties and terms */}
      <div
        className={clsx(
          "grid gap-5 border-b border-paper-200 py-4",
          partyHeading ? "sm:grid-cols-2" : "sm:grid-cols-3",
        )}
      >
        <div>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
            {partyHeading ?? "Bill to"}
          </p>
          <AddressLines address={billTo} className="mt-1" />
        </div>
        {!partyHeading && (
          <div>
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Ship to</p>
            <AddressLines address={shipTo && !isAddressEmpty(shipTo) ? shipTo : billTo} className="mt-1" />
          </div>
        )}
        <dl className="space-y-1 text-[0.8125rem] sm:text-right">
          {secondDateLabel && secondDate && (
            <div className="flex justify-between sm:justify-end sm:gap-6">
              <dt className="text-muted-ink">{secondDateLabel}</dt>
              <dd className="text-ink-800">{formatDate(new Date(`${secondDate}T00:00:00.000Z`))}</dd>
            </div>
          )}
          {reference && (
            <div className="flex justify-between sm:justify-end sm:gap-6">
              <dt className="text-muted-ink">{referenceLabel}</dt>
              <dd className="text-ink-800">{reference}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Lines */}
      {computed.lines.length === 0 ? (
        <p className="py-6 text-center text-[0.8125rem] text-muted-ink">
          No priced lines yet — go back and add an amount.
        </p>
      ) : (
        <Table className="mt-1">
          <thead>
            <tr>
              <Th>Description</Th>
              <Th width="4.5rem" align="right">Qty</Th>
              <Th width="6.5rem" align="right">Rate</Th>
              <Th width="7rem" align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {computed.lines.map((line) => (
              <Tr key={line.lineNo}>
                <Td>
                  <span className="font-medium text-ink-900">{line.description}</span>
                  <span className="block text-[0.75rem] text-muted-ink">{accountName(line.accountId)}</span>
                </Td>
                <Td align="right" className="tnum">{formatQty(line.quantityMilli)}</Td>
                <Td align="right" className="tnum">{money.format(line.unitPriceCents)}</Td>
                <Td align="right" className="tnum">{money.format(line.netCents)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <dl className="w-full max-w-xs space-y-1.5 text-[0.8125rem]">
          <Row label="Subtotal" value={computed.subtotalCents} />
          {computed.discountCents > 0 && <Row label="Discount" value={-computed.discountCents} />}
          {computed.taxByComponent
            .filter((component) => component.taxCents !== 0)
            .map((component) => (
              <Row
                key={component.componentId}
                label={`${component.name} ${formatRate(component.rateMicro)}`}
                value={component.taxCents}
              />
            ))}
          <div className="flex items-center justify-between border-t border-paper-300 pt-2 text-[0.9375rem] font-semibold">
            <dt className="text-ink-900">Total</dt>
            <dd className="tnum text-ink-950">{money.format(computed.totalCents)}</dd>
          </div>
        </dl>
      </div>

      {(memo || company.invoiceFooter) && (
        <p className="mt-4 border-t border-paper-200 pt-3 text-[0.8125rem] leading-6 text-muted-ink">
          {memo}
          {company.invoiceFooter && (
            <>
              <br />
              {company.invoiceFooter}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  const money = useMoney();
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="tnum text-ink-900">{money.format(value)}</dd>
    </div>
  );
}
