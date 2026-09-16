import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, formatDateLong } from "@/lib/dates";
import { formatMoney, formatQty, formatRate } from "@/lib/money";
import { taxRegistrationLines } from "@/lib/tax-registration";
import { Card, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { CreditNoteActions } from "./credit-note-actions";

export default async function CreditNoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const currency = company.baseCurrency;
  const { id } = await params;

  const credit = await db.creditNote.findFirst({
    where: { id, companyId: company.id },
    include: {
      customer: true,
      vendor: true,
      lines: { include: { item: true } },
      sourceInvoice: { select: { id: true, number: true } },
      sourceBill: { select: { id: true, number: true } },
    },
  });
  if (!credit) notFound();

  const companyProfile = await db.company.findUniqueOrThrow({
    where: { id: company.id },
    select: {
      name: true, legalName: true, addressLine1: true, addressLine2: true, city: true, province: true,
      postalCode: true, businessNumber: true, gstNumber: true, qstNumber: true, pstNumber: true,
      email: true, phone: true, website: true, logoUrl: true, creditNoteFooter: true,
    },
  });

  const party = credit.customer ?? credit.vendor;
  const partyHref = credit.customer ? `/sales/customers/${credit.customer.id}` : `/purchases/vendors/${credit.vendor?.id}`;
  const fmt = (cents: number) => formatMoney(cents, { currency });
  // The credit note's own snapshot (issue 2); a pre-existing one with none
  // falls back to today's live company footer.
  const footerText = credit.footerText ?? companyProfile.creditNoteFooter;

  return (
    <>
      <PageHeader
        title={`Credit note ${credit.number}`}
        breadcrumb={[
          { label: "Sales", href: "/sales/invoices" },
          { label: "Credit notes", href: "/sales/credit-notes" },
          { label: credit.number },
        ]}
        description={credit.type === "VENDOR" ? "Vendor credit" : "Customer credit"}
        actions={<StatusBadge status={credit.status} />}
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
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-maple-600">Credit note</p>
              <p className="tnum text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">{credit.number}</p>
              <p className="mt-1 text-[0.8125rem] text-muted-ink">{formatDateLong(credit.issueDate)}</p>
            </div>
          </div>

          <div className="border-b border-paper-200 py-4">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
              {credit.type === "VENDOR" ? "Vendor" : "Customer"}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-6 text-ink-800">
              <span className="font-medium">{party?.name ?? "—"}</span>
            </p>
            {credit.reason && <p className="mt-1 text-[0.8125rem] text-muted-ink">Reason: {credit.reason}</p>}
          </div>

          <Table className="mt-1">
            <thead>
              <tr>
                <Th>Description</Th>
                <Th width="4.5rem" align="right">Qty</Th>
                <Th width="6.5rem" align="right">Unit price</Th>
                <Th width="7rem" align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {credit.lines.map((line) => {
                const grossCents = Math.round((line.quantityMilli * line.unitPriceCents) / 1000);
                const discountCents = grossCents - line.netCents;
                return (
                  <Tr key={line.id}>
                    <Td>
                      <span className="font-medium text-ink-900">
                        {line.item?.code ? `${line.item.code} · ` : ""}
                        {line.description}
                      </span>
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
              <Row label="Subtotal" value={credit.subtotalCents} fmt={fmt} />
              {credit.taxCents !== 0 && <Row label="Tax" value={credit.taxCents} fmt={fmt} />}
              <div className="flex items-center justify-between border-t border-paper-300 pt-2 text-[0.9375rem] font-semibold">
                <dt className="text-ink-900">Total</dt>
                <dd className="tnum text-ink-950">{fmt(credit.totalCents)}</dd>
              </div>
              {credit.appliedCents > 0 && <Row label="Applied" value={-credit.appliedCents} fmt={fmt} />}
              <div className="flex items-center justify-between text-[0.8125rem]">
                <dt className="text-muted-ink">Remaining credit</dt>
                <dd className="tnum text-ink-900">{fmt(credit.balanceCents)}</dd>
              </div>
            </dl>
          </div>

          {(credit.memo || footerText) && (
            <p className="mt-4 border-t border-paper-200 pt-3 text-[0.8125rem] leading-6 text-muted-ink">
              {credit.memo}
              {footerText && (
                <>
                  <br />
                  {footerText}
                </>
              )}
            </p>
          )}
        </Card>

        <div className="no-print space-y-4">
          <CreditNoteActions creditNoteId={credit.id} status={credit.status} appliedCents={credit.appliedCents} />
          <Card className="p-4">
            <dl className="space-y-2 text-[0.75rem]">
              {party && (
                <div>
                  <dt className="text-muted-ink">Party</dt>
                  <dd>
                    <Link href={partyHref} className="text-brand-700 hover:underline">{party.name}</Link>
                  </dd>
                </div>
              )}
              {credit.sourceInvoice && (
                <div>
                  <dt className="text-muted-ink">Returned from</dt>
                  <dd>
                    <Link href={`/sales/invoices/${credit.sourceInvoice.id}`} className="text-brand-700 hover:underline">
                      Invoice {credit.sourceInvoice.number}
                    </Link>
                  </dd>
                </div>
              )}
              {credit.sourceBill && (
                <div>
                  <dt className="text-muted-ink">Returned from</dt>
                  <dd>
                    <Link href={`/purchases/bills/${credit.sourceBill.id}`} className="text-brand-700 hover:underline">
                      Bill {credit.sourceBill.number}
                    </Link>
                  </dd>
                </div>
              )}
              {credit.journalEntryId && (
                <div>
                  <dt className="text-muted-ink">Posted</dt>
                  <dd>
                    <Link href={`/accounting/journals/${credit.journalEntryId}`} className="text-brand-700 hover:underline">
                      {formatDate(credit.postedAt ?? credit.issueDate)}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
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
