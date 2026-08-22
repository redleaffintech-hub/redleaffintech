"use client";

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
  city: string | null;
  province: string;
  postalCode: string | null;
  gstNumber: string | null;
  qstNumber: string | null;
  pstNumber: string | null;
  invoiceFooter: string | null;
}

/**
 * The document as it will read once saved — the last look before anything is
 * posted to the ledger.
 *
 * The totals are not recalculated here. They are the same `computeDocument`
 * result the editor is already showing, which is the same function the posting
 * engine runs on the server, so the preview cannot flatter the numbers.
 */
export function DocumentPreview({
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
  taxInclusive,
  accountName,
  computed,
}: {
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
  taxInclusive: boolean;
  accountName: (accountId: string) => string;
  computed: ReturnType<typeof computeDocument>;
}) {
  const money = useMoney();
  const issued = new Date(`${issueDate}T00:00:00.000Z`);

  return (
    <div className="print-full">
      {/* Letterhead */}
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-paper-200 pb-4">
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
        <div className="text-right">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-maple-600">{title}</p>
          <p className="tnum text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">{number || "—"}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-ink">{formatDateLong(issued)}</p>
        </div>
      </div>

      {/* Parties and terms */}
      <div className="grid gap-5 border-b border-paper-200 py-4 sm:grid-cols-3">
        <div>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Bill to</p>
          <AddressLines address={billTo} className="mt-1" />
        </div>
        <div>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Ship to</p>
          {shipTo && !isAddressEmpty(shipTo) ? (
            <AddressLines address={shipTo} className="mt-1" />
          ) : (
            <p className="mt-1 text-[0.8125rem] leading-6 text-muted-ink">Same as billing address</p>
          )}
        </div>
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
          <div className="flex justify-between sm:justify-end sm:gap-6">
            <dt className="text-muted-ink">Pricing</dt>
            <dd className="text-ink-800">{taxInclusive ? "Tax inclusive" : "Tax exclusive"}</dd>
          </div>
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
