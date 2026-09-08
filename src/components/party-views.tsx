import Link from "next/link";
import { Card, EmptyState, LinkButton, Money, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { formatDate, formatDateLong } from "@/lib/dates";

/**
 * Customers and vendors are the same shape from the UI's point of view, so the
 * list and the statement are written once and parameterised.
 */

export interface PartyRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  province: string | null;
  paymentTermsDays: number;
  isActive: boolean;
  taxCodeLabel: string | null;
  openDocuments: number;
  outstandingCents: number;
  lifetimeCents: number;
}

export function PartyTable({
  rows,
  hrefBase,
  kind,
  newHref,
}: {
  rows: PartyRow[];
  hrefBase: string;
  kind: "customer" | "vendor";
  /** Where the empty state sends someone to create the first one, if anywhere. */
  newHref?: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${kind}s yet`}
        description={
          kind === "customer"
            ? "Customers hold the receivable balance, the payment terms and the default tax code applied to their invoices."
            : "Vendors hold the payable balance, the payment terms and the default tax code applied to their bills."
        }
        action={
          newHref ? (
            <LinkButton href={newHref} variant="primary">
              {`Add ${kind}`}
            </LinkButton>
          ) : undefined
        }
      />
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th width="14rem">Contact</Th>
          <Th width="8rem">Location</Th>
          <Th width="7rem">Tax default</Th>
          <Th width="5rem" align="right">Open</Th>
          <Th width="9rem" align="right">Outstanding</Th>
          <Th width="9rem" align="right">
            {kind === "customer" ? "Billed to date" : "Spent to date"}
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link href={`${hrefBase}/${row.id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                {row.name}
              </Link>
              {!row.isActive && <span className="ml-1.5 text-[0.6875rem] uppercase text-muted-ink">archived</span>}
              <span className="block text-[0.75rem] text-muted-ink">Net {row.paymentTermsDays}</span>
            </Td>
            <Td className="text-muted-ink">
              {row.email ?? "—"}
              {row.phone && <span className="block text-[0.75rem]">{row.phone}</span>}
            </Td>
            <Td className="text-muted-ink">
              {[row.city, row.province].filter(Boolean).join(", ") || "—"}
            </Td>
            <Td className="text-[0.75rem] text-muted-ink">{row.taxCodeLabel ?? "—"}</Td>
            <Td align="right" className="tnum text-muted-ink">{row.openDocuments || "—"}</Td>
            <Td align="right"><Money cents={row.outstandingCents} bold={row.outstandingCents > 0} blankZero /></Td>
            <Td align="right"><Money cents={row.lifetimeCents} blankZero /></Td>
          </Tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <Td colSpan={5} className="pt-3 font-medium text-ink-700">{rows.length} record(s)</Td>
          <Td align="right" className="pt-3">
            <Money cents={rows.reduce((s, r) => s + r.outstandingCents, 0)} bold />
          </Td>
          <Td align="right" className="pt-3">
            <Money cents={rows.reduce((s, r) => s + r.lifetimeCents, 0)} bold />
          </Td>
        </tr>
      </tfoot>
    </Table>
  );
}

export interface StatementRowData {
  id: string;
  date: Date;
  entryNo: string;
  journalEntryId: string;
  reference: string | null;
  description: string | null;
  movementCents: number;
  runningBalanceCents: number;
}

/**
 * The formal customer-statement document: dark letterhead, Bill To / Account
 * Summary, the period, the transaction table and the closing strip. Passed to
 * `PartyStatement` as `document`; without it the plain vendor table renders.
 */
export interface StatementDocument {
  currency: string;
  company: {
    name: string;
    addressLines: string[];
    email: string | null;
    phone: string | null;
    website: string | null;
  };
  billTo: {
    name: string;
    lines: string[];
    email: string | null;
    phone: string | null;
  };
  statementNumber: string;
  statementDate: Date;
  /** The customer's account reference. */
  customerRef: string;
  /** Rendered only when there is a balance owing and an open invoice to date it. */
  paymentDueDate: Date | null;
  summary: {
    previousBalanceCents: number;
    creditsCents: number;
    newChargesCents: number;
    totalDueCents: number;
  };
  /** A factual account-position note; hidden when empty. */
  message: string | null;
}

/** Opening balance, activity, payments, closing balance (§12). */
export function PartyStatement({
  openingCents,
  rows,
  closingCents,
  from,
  to,
  document,
}: {
  openingCents: number;
  rows: StatementRowData[];
  closingCents: number;
  from: Date;
  to: Date;
  document?: StatementDocument;
}) {
  if (document) {
    return (
      <StatementPaper
        openingCents={openingCents}
        rows={rows}
        closingCents={closingCents}
        from={from}
        to={to}
        document={document}
      />
    );
  }

  return (
    <Card className="p-5">
      <Table>
        <thead>
          <tr>
            <Th width="7rem">Date</Th>
            <Th width="7rem">Entry</Th>
            <Th>Description</Th>
            <Th width="9rem" align="right">Charge / payment</Th>
            <Th width="9rem" align="right">Balance</Th>
          </tr>
        </thead>
        <tbody>
          <Tr className="bg-paper-100">
            <Td colSpan={4} className="font-medium text-muted-ink">
              Opening balance at {formatDate(from)}
            </Td>
            <Td align="right"><Money cents={openingCents} bold /></Td>
          </Tr>
          {rows.map((row) => (
            <Tr key={row.id}>
              <Td className="text-muted-ink">{formatDate(row.date)}</Td>
              <Td>
                <Link href={`/accounting/journals/${row.journalEntryId}`} className="tnum text-ink-800 hover:text-brand-700 hover:underline">
                  {row.entryNo}
                </Link>
              </Td>
              <Td className="text-ink-800">
                {row.description ?? "—"}
                {row.reference && <span className="ml-1.5 text-[0.75rem] text-muted-ink">{row.reference}</span>}
              </Td>
              <Td align="right"><Money cents={row.movementCents} colorNegative /></Td>
              <Td align="right"><Money cents={row.runningBalanceCents} /></Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={5} className="py-8 text-center text-muted-ink">No activity in this period.</Td>
            </Tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <Td colSpan={4} className="pt-3 font-semibold text-ink-950">
              Closing balance at {formatDate(to)}
            </Td>
            <Td align="right" className="pt-3"><Money cents={closingCents} bold /></Td>
          </tr>
        </tfoot>
      </Table>
    </Card>
  );
}

/** The approved statement layout. Screen and print read from `.statement-paper`. */
function StatementPaper({
  openingCents,
  rows,
  closingCents,
  from,
  to,
  document,
}: {
  openingCents: number;
  rows: StatementRowData[];
  closingCents: number;
  from: Date;
  to: Date;
  document: StatementDocument;
}) {
  const { currency, company, billTo, summary } = document;
  const cents = (value: number) => <Money cents={value} currency={currency} />;

  const contactBits = [company.phone, company.email, company.website].filter(Boolean) as string[];
  const billContact = [billTo.phone, billTo.email].filter(Boolean) as string[];

  return (
    <Card padded={false} className="statement-paper print-full overflow-hidden print:overflow-visible">
      {/* Full-width dark letterhead */}
      <div className="st-header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{company.name}</p>
          <div className="mt-1 space-y-0.5 text-[0.75rem] leading-5 text-white/80">
            {company.addressLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {contactBits.map((bit) => (
              <p key={bit}>{bit}</p>
            ))}
          </div>
        </div>
        <p className="text-[1.75rem] font-bold uppercase tracking-[0.06em]">Statement</p>
      </div>
      <div className="st-rule" />

      {/* Statement identifiers, right-aligned beneath the header */}
      <div className="px-5 pt-4">
        <dl className="ml-auto w-full max-w-xs space-y-0.5 text-[0.8125rem] sm:text-right">
          <div className="flex justify-between gap-6 sm:justify-end">
            <dt className="st-muted">Statement date</dt>
            <dd className="font-medium">{formatDateLong(document.statementDate)}</dd>
          </div>
          <div className="flex justify-between gap-6 sm:justify-end">
            <dt className="st-muted">Statement no.</dt>
            <dd className="tnum font-medium">{document.statementNumber}</dd>
          </div>
          <div className="flex justify-between gap-6 sm:justify-end">
            <dt className="st-muted">Customer ID</dt>
            <dd className="font-mono text-[0.75rem]">{document.customerRef}</dd>
          </div>
        </dl>
      </div>

      {/* Bill To + Account Summary */}
      <div className="grid gap-4 px-5 pt-4 sm:grid-cols-2">
        <div className="st-keep">
          <div className="st-band">Bill to</div>
          <div className="st-box text-[0.8125rem] leading-6">
            <p className="font-medium">{billTo.name}</p>
            {billTo.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {billContact.map((bit) => (
              <p key={bit} className="st-muted">{bit}</p>
            ))}
          </div>
        </div>

        <div className="st-keep">
          <div className="st-band">Account summary</div>
          <table className="st-summary text-[0.8125rem]">
            <tbody>
              <tr>
                <td className="st-muted">Previous balance</td>
                <td>{cents(summary.previousBalanceCents)}</td>
              </tr>
              <tr>
                <td className="st-muted">Credits</td>
                <td>{cents(-summary.creditsCents)}</td>
              </tr>
              <tr>
                <td className="st-muted">New charges</td>
                <td>{cents(summary.newChargesCents)}</td>
              </tr>
              <tr className="st-total">
                <td>Total balance due</td>
                <td>{cents(summary.totalDueCents)}</td>
              </tr>
              {document.paymentDueDate && (
                <tr>
                  <td className="st-muted">Payment due date</td>
                  <td>{formatDate(document.paymentDueDate)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Statement period */}
      <p className="px-5 pt-4 text-[0.8125rem] font-medium">
        Statement period{" "}
        <span className="st-muted">
          {formatDate(from)} – {formatDate(to)}
        </span>
      </p>

      {/* Transactions */}
      <div className="st-scroll px-5 pt-2">
        <table className="st-table min-w-[42rem]">
          <thead>
            <tr>
              <th className="w-24">Date</th>
              <th className="w-24">Invoice #</th>
              <th>Description</th>
              <th className="st-num w-28">Charges</th>
              <th className="st-num w-28">Credits</th>
              <th className="st-num w-32">Account balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="whitespace-nowrap">{formatDate(from)}</td>
              <td />
              <td className="st-muted">Balance forward</td>
              <td className="st-num" />
              <td className="st-num" />
              <td className="st-num">{cents(openingCents)}</td>
            </tr>
            {rows.map((row) => {
              const charge = row.movementCents > 0 ? row.movementCents : null;
              const credit = row.movementCents < 0 ? -row.movementCents : null;
              return (
                <tr key={row.id}>
                  <td className="whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="tnum whitespace-nowrap">{row.reference ?? ""}</td>
                  <td>{row.description ?? "—"}</td>
                  <td className="st-num">{charge !== null ? cents(charge) : ""}</td>
                  <td className="st-num">{credit !== null ? cents(credit) : ""}</td>
                  <td className="st-num">{cents(row.runningBalanceCents)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="st-muted py-6 text-center">
                  No transactions in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Closing strip + message */}
      <div className="px-5 pb-5 pt-1">
        <div className="st-current">
          <span>Account current balance</span>
          <span className="tnum">{cents(closingCents)}</span>
        </div>

        {document.message && (
          <div className="st-message text-[0.8125rem] leading-6">{document.message}</div>
        )}
        <p className="st-thanks st-accent">Thank you for your business!</p>
      </div>
    </Card>
  );
}

export function DocumentList({
  title,
  documents,
  hrefBase,
}: {
  title: string;
  documents: { id: string; number: string; date: Date; dueDate: Date; totalCents: number; balanceCents: number; status: string }[];
  hrefBase: string;
}) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-[0.9375rem] font-semibold text-ink-900">{title}</h2>
      {documents.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-ink">Nothing recorded yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th width="7rem">Number</Th>
              <Th width="7rem">Date</Th>
              <Th width="7rem">Due</Th>
              <Th align="right">Total</Th>
              <Th align="right">Balance</Th>
              <Th width="7rem">Status</Th>
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <Tr key={document.id}>
                <Td>
                  <Link href={`${hrefBase}/${document.id}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                    {document.number}
                  </Link>
                </Td>
                <Td className="text-muted-ink">{formatDate(document.date)}</Td>
                <Td className="text-muted-ink">{formatDate(document.dueDate)}</Td>
                <Td align="right"><Money cents={document.totalCents} /></Td>
                <Td align="right"><Money cents={document.balanceCents} blankZero /></Td>
                <Td><StatusBadge status={document.status} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
