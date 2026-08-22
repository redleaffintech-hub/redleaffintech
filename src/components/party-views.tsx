import Link from "next/link";
import { Card, EmptyState, LinkButton, Money, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { formatDate } from "@/lib/dates";

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

/** Opening balance, activity, payments, closing balance (§12). */
export function PartyStatement({
  openingCents,
  rows,
  closingCents,
  from,
  to,
}: {
  openingCents: number;
  rows: StatementRowData[];
  closingCents: number;
  from: Date;
  to: Date;
}) {
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
