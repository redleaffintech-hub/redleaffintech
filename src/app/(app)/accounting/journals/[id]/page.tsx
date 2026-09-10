import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntryWithLines, getEntry, findReversalOf } from "@/server/db/journal-entries";
import { listAccounts } from "@/server/db/accounts";
import { getCustomer } from "@/server/db/customers";
import { getVendor } from "@/server/db/vendors";
import { getFiscalPeriod } from "@/server/db/fiscal-periods";
import { listTaxEntriesForJournalEntry } from "@/server/db/tax-entries";
import { getTaxCodesByIds } from "@/server/db/tax-codes";
import { getUser } from "@/server/db/users";
import { listAuditLogs } from "@/server/db/audit-logs";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { SOURCE_LABELS } from "@/lib/enums";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  Badge, Callout, Card, CardHeader, DefinitionList, Money, PageHeader, StatusBadge, Table, Td, Th, Tr,
} from "@/components/ui";
import { ReverseButton } from "./reverse-button";

const SOURCE_HREF: Record<string, string> = {
  INVOICE: "/sales/invoices",
  BILL: "/purchases/bills",
  EXPENSE: "/expenses",
  CREDIT_NOTE: "/sales/credit-notes",
};

export default async function JournalDetailPage({ params }: PageProps<"/accounting/journals/[id]">) {
  const { company, role } = await requireCapability(CAPABILITIES.REPORTS);
  const currency = company.baseCurrency;
  const { id } = await params;

  const rawEntry = await getEntryWithLines(company.id, id);
  if (!rawEntry) notFound();

  const [accounts, taxEntryRows, fiscalPeriod, reversalOf, reversedBy, createdBy, allAudit] =
    await Promise.all([
      listAccounts(company.id),
      listTaxEntriesForJournalEntry(company.id, rawEntry.id),
      rawEntry.fiscalPeriodId ? getFiscalPeriod(company.id, rawEntry.fiscalPeriodId) : Promise.resolve(null),
      rawEntry.reversalOfId ? getEntry(company.id, rawEntry.reversalOfId) : Promise.resolve(null),
      findReversalOf(company.id, rawEntry.id),
      rawEntry.createdById ? getUser(rawEntry.createdById) : Promise.resolve(null),
      listAuditLogs(company.id, { limit: 40 }),
    ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const partyNames = new Map<string, string>();
  await Promise.all(
    rawEntry.lines.flatMap((l) => [
      l.customerId
        ? getCustomer(company.id, l.customerId).then((c) => c && partyNames.set(l.customerId!, c.name))
        : null,
      l.vendorId
        ? getVendor(company.id, l.vendorId).then((v) => v && partyNames.set(l.vendorId!, v.name))
        : null,
    ]).filter(Boolean) as Promise<unknown>[],
  );
  const taxCodeById = await getTaxCodesByIds(
    company.id,
    taxEntryRows.map((t) => t.taxCodeId).filter((x): x is string => Boolean(x)),
  );

  const entry = {
    ...rawEntry,
    fiscalPeriod,
    reversalOf: reversalOf ? { id: reversalOf.id, entryNo: reversalOf.entryNo } : null,
    reversedBy: reversedBy ? { id: reversedBy.id, entryNo: reversedBy.entryNo } : null,
    lines: rawEntry.lines.map((l) => ({
      ...l,
      account: accountById.get(l.accountId) ?? { code: "", name: "", type: "" },
      customer: l.customerId ? { name: partyNames.get(l.customerId) ?? "" } : null,
      vendor: l.vendorId ? { name: partyNames.get(l.vendorId) ?? "" } : null,
    })),
    taxEntries: taxEntryRows.map((t) => ({
      ...t,
      taxCode: t.taxCodeId ? taxCodeById.get(t.taxCodeId) ?? { code: "" } : { code: "" },
    })),
  };

  const audit = allAudit
    .filter((a) => a.entityType === "JournalEntry" && a.entityId === entry.id)
    .slice(0, 6)
    .map((a) => ({ ...a, user: null as { name: string } | null }));

  const sourceHref = SOURCE_HREF[entry.sourceType];

  return (
    <>
      <PageHeader
        title={`Journal ${entry.entryNo}`}
        breadcrumb={[
          { label: "Accounting" },
          { label: "Journal entries", href: "/accounting/journals" },
          { label: entry.entryNo },
        ]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={entry.status} />
            {entry.isAdjusting && <Badge tone="caution">adjusting entry</Badge>}
            <span className="text-muted-ink">{entry.memo}</span>
          </span>
        }
        actions={
          entry.status === "POSTED" &&
          can(role, CAPABILITIES.JOURNALS) && <ReverseButton entryId={entry.id} entryNo={entry.entryNo} />
        }
      />

      {entry.reversedBy && (
        <div className="mb-4">
          <Callout
            tone="caution"
            title={`This entry was reversed by ${entry.reversedBy.entryNo}`}
            action={
              <Link href={`/accounting/journals/${entry.reversedBy.id}`} className="text-[0.8125rem] font-medium text-brand-700 hover:underline">
                Open reversal
              </Link>
            }
          >
            The original posting is preserved. Both entries remain in the ledger and net to zero.
          </Callout>
        </div>
      )}
      {entry.reversalOf && (
        <div className="mb-4">
          <Callout
            tone="info"
            title={`This entry reverses ${entry.reversalOf.entryNo}`}
            action={
              <Link href={`/accounting/journals/${entry.reversalOf.id}`} className="text-[0.8125rem] font-medium text-brand-700 hover:underline">
                Open original
              </Link>
            }
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_19rem] lg:items-start">
        <Card className="p-5">
          <CardHeader title="Postings" subtitle={`${entry.lines.length} lines`} />
          <Table className="mt-3">
            <thead>
              <tr>
                <Th width="3rem">#</Th>
                <Th>Account</Th>
                <Th>Description</Th>
                <Th width="9rem" align="right">Debit</Th>
                <Th width="9rem" align="right">Credit</Th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => (
                <Tr key={line.id}>
                  <Td className="tnum text-muted-ink">{line.lineNo}</Td>
                  <Td>
                    <Link href={`/accounting/general-ledger?account=${line.accountId}`} className="hover:text-brand-700 hover:underline">
                      <span className="tnum mr-2 text-[0.75rem] text-muted-ink">{line.account.code}</span>
                      <span className="font-medium text-ink-900">{line.account.name}</span>
                    </Link>
                    <span className="block text-[0.75rem] text-muted-ink">
                      {line.account.type.toLowerCase()} · {line.accountType === line.account.type ? "" : ""}
                      {line.customer?.name ?? line.vendor?.name ?? ""}
                    </span>
                  </Td>
                  <Td className="text-muted-ink">{line.description ?? "—"}</Td>
                  <Td align="right"><Money cents={line.debitCents} blankZero /></Td>
                  <Td align="right"><Money cents={line.creditCents} blankZero /></Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={3} className="pt-3 font-semibold text-ink-950">Totals</Td>
                <Td align="right" className="pt-3"><Money cents={entry.totalDebitCents} bold /></Td>
                <Td align="right" className="pt-3"><Money cents={entry.totalCreditCents} bold /></Td>
              </tr>
            </tfoot>
          </Table>

          <div
            className={`mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-[0.8125rem] ${
              entry.totalDebitCents === entry.totalCreditCents
                ? "bg-positive-soft text-positive"
                : "bg-negative-soft text-negative"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {entry.totalDebitCents === entry.totalCreditCents
              ? `Balanced — debits and credits both total ${formatMoney(entry.totalDebitCents, { currency })}.`
              : `Out of balance by ${formatMoney(Math.abs(entry.totalDebitCents - entry.totalCreditCents), { currency })}.`}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Entry details" />
            <div className="mt-3">
              <DefinitionList
                items={[
                  { label: "Date", value: formatDate(entry.date) },
                  { label: "Period", value: entry.fiscalPeriod ? `${entry.fiscalPeriod.name} (${entry.fiscalPeriod.status.toLowerCase()})` : "—" },
                  {
                    label: "Source",
                    value: sourceHref && entry.sourceId ? (
                      <Link href={`${sourceHref}/${entry.sourceId}`} className="text-brand-700 hover:underline">
                        {SOURCE_LABELS[entry.sourceType]} {entry.sourceNumber}
                      </Link>
                    ) : (
                      `${SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}${entry.sourceNumber ? ` ${entry.sourceNumber}` : ""}`
                    ),
                  },
                  { label: "Posted by", value: createdBy?.name ?? "System" },
                  { label: "Posted at", value: entry.postedAt ? formatDateTime(entry.postedAt) : "—" },
                  { label: "Entry number", value: entry.entryNo },
                ]}
              />
            </div>
          </Card>

          {entry.taxEntries.length > 0 && (
            <Card>
              <CardHeader title="Tax recorded" subtitle="Feeds the tax reports" />
              <ul className="mt-3 space-y-1.5 text-[0.8125rem]">
                {entry.taxEntries.map((tax) => (
                  <li key={tax.id} className="flex items-center gap-2">
                    <Badge tone="info">{tax.kind}</Badge>
                    <span className="flex-1 truncate text-muted-ink">{tax.taxCode.code}</span>
                    <Money cents={tax.taxCents} bold />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Immutability" />
            <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
              A posted journal entry is never edited or deleted in Red Leaf Accounting. If it is wrong, reverse it — the
              reversal is a new mirror-image entry that keeps both the error and the correction visible to a reviewer.
            </p>
            {audit.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-paper-200 pt-3">
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
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
