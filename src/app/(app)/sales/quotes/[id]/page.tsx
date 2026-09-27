import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { getCompanyProfile } from "@/server/companies/profile";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate, formatDateLong } from "@/lib/dates";
import { formatMoney, formatQty, formatRate } from "@/lib/money";
import { taxRegistrationLines } from "@/lib/tax-registration";
import { Card, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { QuoteActions } from "./quote-actions";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { company, role } = await requireCapability(CAPABILITIES.INVOICES);
  const currency = company.baseCurrency;
  const { id } = await params;

  const [quote, companyProfile] = await Promise.all([
    db.estimate.findFirst({
      where: { id, companyId: company.id },
      include: {
        customer: true,
        lines: { orderBy: { lineNo: "asc" }, include: { item: true } },
      },
    }),
    getCompanyProfile(company.id),
  ]);
  if (!quote) notFound();

  const canEdit = can(role, CAPABILITIES.INVOICES) && quote.status !== "CONVERTED";
  const fmt = (cents: number) => formatMoney(cents, { currency });

  // Addresses come off the quote's own snapshot; a quote saved before that
  // column existed falls back to the customer record (documented compatibility
  // path, same convention the invoice detail page uses).
  const billTo = {
    name: quote.billToName ?? quote.customer.name,
    line1: quote.billToLine1 ?? quote.customer.addressLine1,
    line2: quote.billToLine2 ?? quote.customer.addressLine2,
    city: quote.billToCity ?? quote.customer.city,
    province: quote.billToProvince ?? quote.customer.province,
    postalCode: quote.billToPostalCode ?? quote.customer.postalCode,
  };
  const shipTo = quote.shipToLine1 || quote.shipToCity || quote.shipToProvince
    ? {
        name: quote.shipToName ?? quote.customer.name,
        line1: quote.shipToLine1,
        line2: quote.shipToLine2,
        city: quote.shipToCity,
        province: quote.shipToProvince,
        postalCode: quote.shipToPostalCode,
      }
    : null;

  const hasItemColumn = quote.lines.some((line) => line.item);

  return (
    <>
      <PageHeader
        title={`Quote ${quote.number}`}
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Sales quotes", href: "/sales/quotes" },
          { label: quote.number },
        ]}
        description={
          quote.status === "CONVERTED"
            ? "Converted to an invoice — the quote itself is now read-only."
            : "A quote posts nothing to the ledger until it is converted to an invoice."
        }
        actions={<StatusBadge status={quote.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem] lg:items-start">
        <Card className="print-full p-6">
          <div className="flex flex-wrap items-start justify-between gap-6 border-b border-paper-200 pb-4">
            <div>
              {companyProfile.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimizable remote asset
                <img src={companyProfile.logoUrl} alt="" className="mb-2 h-12 w-12 rounded object-contain" />
              )}
              <p className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink-950">
                {companyProfile.legalName ?? companyProfile.name}
              </p>
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
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-maple-600">Sales quote</p>
              <p className="tnum text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">{quote.number}</p>
              <p className="mt-1 text-[0.8125rem] text-muted-ink">{formatDateLong(quote.issueDate)}</p>
              {quote.expiryDate && (
                <p className="text-[0.75rem] text-muted-ink">Valid until {formatDate(quote.expiryDate)}</p>
              )}
            </div>
          </div>

          <div className="grid gap-5 border-b border-paper-200 py-4 sm:grid-cols-2">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Bill to</p>
              <p className="mt-1 text-[0.8125rem] leading-6 text-ink-800">
                <span className="font-medium">{billTo.name}</span>
                <br />
                {addressBody(billTo)}
              </p>
            </div>
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Ship to</p>
              <p className="mt-1 text-[0.8125rem] leading-6 text-ink-800">
                <span className="font-medium">{(shipTo ?? billTo).name}</span>
                <br />
                {addressBody(shipTo ?? billTo)}
              </p>
            </div>
          </div>

          <Table className="mt-1">
            <thead>
              <tr>
                {hasItemColumn && <Th width="6rem">Item #</Th>}
                <Th>Description</Th>
                <Th width="4.5rem" align="right">Qty</Th>
                <Th width="6.5rem" align="right">Unit price</Th>
                <Th width="7rem" align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line) => {
                const grossCents = Math.round((line.quantityMilli * line.unitPriceCents) / 1000);
                const discountCents = grossCents - line.netCents;
                return (
                  <Tr key={line.id}>
                    {hasItemColumn && <Td className="tnum">{line.item?.code ?? ""}</Td>}
                    <Td>
                      <span className="font-medium text-ink-900">{line.description}</span>
                      {discountCents > 0 && (
                        <span className="block text-[0.75rem] text-muted-ink">
                          {line.discountMode === "FIXED" ? `${fmt(discountCents)} off` : `${formatRate(line.discountPercentMicro / 100)} off`}
                        </span>
                      )}
                    </Td>
                    <Td align="right" className="tnum">{formatQty(line.quantityMilli)}</Td>
                    <Td align="right" className="tnum">{fmt(line.unitPriceCents)}</Td>
                    <Td align="right" className="tnum">{fmt(line.netCents)}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>

          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-xs space-y-1.5 text-[0.8125rem]">
              <Row label="Subtotal" value={quote.subtotalCents} fmt={fmt} />
              {quote.taxCents !== 0 && <Row label="Tax" value={quote.taxCents} fmt={fmt} />}
              <div className="flex items-center justify-between border-t border-paper-300 pt-2 text-[0.9375rem] font-semibold">
                <dt className="text-ink-900">Total</dt>
                <dd className="tnum text-ink-950">{fmt(quote.totalCents)}</dd>
              </div>
            </dl>
          </div>

          {(quote.memo || quote.footerText) && (
            <p className="mt-4 border-t border-paper-200 pt-3 text-[0.8125rem] leading-6 text-muted-ink">
              {quote.memo}
              {quote.footerText && (
                <>
                  <br />
                  {quote.footerText}
                </>
              )}
            </p>
          )}
        </Card>

        <div className="no-print space-y-4">
          <QuoteActions
            quoteId={quote.id}
            status={quote.status}
            convertedInvoiceId={quote.convertedInvoiceId}
            canEdit={canEdit}
          />
          <Card className="p-4">
            <p className="text-[0.75rem] leading-5 text-muted-ink">
              <Link href={`/sales/customers/${quote.customer.id}`} className="text-brand-700 hover:underline">
                {quote.customer.name}
              </Link>
              {" · "}Net {quote.customer.paymentTermsDays} terms
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, fmt }: { label: string; value: number; fmt: (cents: number) => string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="tnum text-ink-900">{fmt(value)}</dd>
    </div>
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
