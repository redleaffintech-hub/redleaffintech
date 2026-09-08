import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can, canApprove } from "@/lib/permissions";
import { formatDate, formatDateTime, daysBetween, today } from "@/lib/dates";
import { formatMoney, formatQty } from "@/lib/money";
import { Badge, Card, CardHeader, DefinitionList, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { BillActions } from "./bill-actions";

export default async function BillDetailPage({ params }: PageProps<"/purchases/bills/[id]">) {
  const { company, role } = await requireCapability(CAPABILITIES.BILLS);
  const currency = company.baseCurrency;
  const { id } = await params;

  const bill = await db.bill.findFirst({
    where: { id, companyId: company.id },
    include: {
      vendor: true,
      lines: { orderBy: { lineNo: "asc" }, include: { account: true, taxCode: true } },
      allocations: { include: { payment: true }, orderBy: { date: "asc" } },
      journalEntry: { include: { lines: { include: { account: true }, orderBy: { lineNo: "asc" } } } },
    },
  });
  if (!bill) notFound();

  const [bankAccounts, taxEntries, audit] = await Promise.all([
    db.account.findMany({
      where: { companyId: company.id, subtype: { in: ["BANK", "CASH", "CREDIT_CARD"] }, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
    db.taxEntry.findMany({
      where: { companyId: company.id, sourceType: "BILL", sourceId: bill.id },
    }),
    db.auditLog.findMany({
      where: { companyId: company.id, entityType: "Bill", entityId: bill.id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
      take: 8,
    }),
  ]);

  const overdueDays = daysBetween(bill.dueDate, today());
  const editable =
    bill.status !== "VOID" && bill.allocations.length === 0 && bill.amountPaidCents === 0;
  const recoverableCents = taxEntries.reduce((s, t) => s + t.recoverableCents, 0);
  const nonRecoverableCents = taxEntries.reduce((s, t) => s + t.taxCents - t.recoverableCents, 0);

  return (
    <>
      <PageHeader
        title={`Bill ${bill.number}`}
        breadcrumb={[{ label: "Purchases", href: "/purchases/bills" }, { label: "Bills", href: "/purchases/bills" }, { label: bill.number }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={bill.status} />
            {bill.approvalStatus === "PENDING" && <Badge tone="caution">awaiting approval</Badge>}
            {bill.balanceCents > 0 && overdueDays > 0 && <Badge tone="negative">{overdueDays} days overdue</Badge>}
            <span className="text-muted-ink">
              {bill.vendor.name} · dated {formatDate(bill.issueDate)} · due {formatDate(bill.dueDate)}
            </span>
          </span>
        }
        actions={
          <BillActions
            billId={bill.id}
            status={bill.status}
            approvalStatus={bill.approvalStatus}
            balanceCents={bill.balanceCents}
            isPosted={Boolean(bill.journalEntryId)}
            bankAccounts={bankAccounts}
            canPay={can(role, CAPABILITIES.PAYMENTS)}
            canApprove={canApprove(role, CAPABILITIES.BILLS)}
            canEdit={can(role, CAPABILITIES.BILLS)}
            editable={editable}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <Card className="p-5">
          <CardHeader
            title={bill.memo ?? "Bill lines"}
            subtitle={bill.vendorInvoiceNo ? `Vendor invoice ${bill.vendorInvoiceNo}` : undefined}
          />
          <Table className="mt-3">
            <thead>
              <tr>
                <Th>Description</Th>
                <Th width="12rem">Account</Th>
                <Th width="4.5rem" align="right">Qty</Th>
                <Th width="7rem" align="right">Rate</Th>
                <Th width="5rem">Tax</Th>
                <Th width="8rem" align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => (
                <Tr key={line.id}>
                  <Td className="font-medium text-ink-900">{line.description}</Td>
                  <Td className="text-muted-ink">
                    {line.account.code} · {line.account.name}
                  </Td>
                  <Td align="right" className="tnum">{formatQty(line.quantityMilli)}</Td>
                  <Td align="right"><Money cents={line.unitPriceCents} /></Td>
                  <Td className="text-[0.75rem] text-muted-ink">{line.taxCode?.code ?? "—"}</Td>
                  <Td align="right"><Money cents={line.netCents} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>

          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-xs space-y-1.5 text-[0.8125rem]">
              <Row label="Subtotal" value={bill.subtotalCents} currency={currency} />
              <Row label="Tax" value={bill.taxCents} currency={currency} />
              <div className="flex items-center justify-between border-t border-paper-300 pt-2 text-[0.9375rem] font-semibold">
                <dt className="text-ink-900">Total</dt>
                <dd className="tnum text-ink-950">{formatMoney(bill.totalCents, { currency })}</dd>
              </div>
              {bill.amountPaidCents > 0 && <Row label="Paid" value={-bill.amountPaidCents} currency={currency} />}
              <div className="flex items-center justify-between rounded-md bg-paper-100 px-2 py-1.5 text-[0.9375rem] font-semibold">
                <dt className="text-ink-900">Balance owing</dt>
                <dd className="tnum text-ink-950">{formatMoney(bill.balanceCents, { currency })}</dd>
              </div>
            </dl>
          </div>

          {(recoverableCents > 0 || nonRecoverableCents > 0) && (
            <div className="mt-5 rounded-lg bg-paper-100 p-3.5">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Tax treatment</p>
              <ul className="mt-1.5 space-y-1 text-[0.8125rem] text-ink-700">
                {recoverableCents > 0 && (
                  <li className="flex items-center justify-between">
                    <span>Recoverable as an input tax credit</span>
                    <Money cents={recoverableCents} bold />
                  </li>
                )}
                {nonRecoverableCents > 0 && (
                  <li className="flex items-center justify-between">
                    <span>Non-recoverable — capitalised into the expense</span>
                    <Money cents={nonRecoverableCents} bold />
                  </li>
                )}
              </ul>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Ledger entry" subtitle={bill.journalEntry ? "What this bill posted" : "Not posted yet"} />
            {bill.journalEntry ? (
              <>
                <Link href={`/accounting/journals/${bill.journalEntry.id}`} className="mt-3 flex items-center gap-2 text-[0.8125rem] font-medium text-brand-700 hover:underline">
                  {bill.journalEntry.entryNo}
                  <span className="text-muted-ink">· {formatDate(bill.journalEntry.date)}</span>
                </Link>
                <ul className="mt-2 space-y-1 text-[0.75rem]">
                  {bill.journalEntry.lines.map((line) => (
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
              </>
            ) : (
              <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
                This bill has not been posted. It affects no account balance and appears in no report until it is.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader title="Vendor" />
            <div className="mt-3">
              <DefinitionList
                items={[
                  {
                    label: "Name",
                    value: (
                      <Link href={`/purchases/vendors/${bill.vendorId}`} className="text-brand-700 hover:underline">
                        {bill.vendor.name}
                      </Link>
                    ),
                  },
                  { label: "Terms", value: `Net ${bill.vendor.paymentTermsDays}` },
                  { label: "Email", value: bill.vendor.email ?? "—" },
                  { label: "Their invoice no.", value: bill.vendorInvoiceNo ?? "—" },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Payments" subtitle={`${bill.allocations.length} applied`} />
            {bill.allocations.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-muted-ink">No payments recorded against this bill.</p>
            ) : (
              <ul className="mt-3 divide-y divide-paper-200">
                {bill.allocations.map((allocation) => (
                  <li key={allocation.id} className="flex items-center gap-2 py-2 text-[0.8125rem]">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink-900">{allocation.payment?.number ?? "Credit"}</span>
                      <span className="text-[0.75rem] text-muted-ink">{formatDate(allocation.date)}</span>
                    </span>
                    <Money cents={allocation.amountCents} bold />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {audit.length > 0 && (
            <Card>
              <CardHeader title="History" />
              <ul className="mt-3 space-y-2.5">
                {audit.map((event) => (
                  <li key={event.id} className="flex gap-2.5 text-[0.75rem]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-300" />
                    <span>
                      <span className="block text-ink-800">{event.summary}</span>
                      <span className="text-muted-ink">
                        {event.user?.name ?? "System"} · {formatDateTime(event.createdAt)}
                      </span>
                    </span>
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

function Row({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="tnum text-ink-900">{formatMoney(value, { currency })}</dd>
    </div>
  );
}
