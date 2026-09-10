import Link from "next/link";
import { creditNotes as creditNotesRepo } from "@/server/db/credit-notes";
import { getCustomer } from "@/server/db/customers";
import { getVendor } from "@/server/db/vendors";
import { listAccounts } from "@/server/db/accounts";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { formatDate, dateRangeWhere } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, EmptyState, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { DateRangeFilter, FilterBar } from "@/components/filter-bar";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Credit notes" };

export default async function CreditNotesPage({ searchParams }: PageProps<"/sales/credit-notes">) {
  const { company } = await requireCapability(CAPABILITIES.INVOICES);
  const currency = company.baseCurrency;
  const params = await searchParams;
  const type = typeof params.type === "string" ? params.type : "";
  const issuedBetween = dateRangeWhere(params.from, params.to);

  const from = issuedBetween?.gte ?? null;
  const to = issuedBetween?.lte ?? null;

  const [allNotes, accounts] = await Promise.all([
    creditNotesRepo.list(company.id, { orderBy: "issueDate", direction: "desc" }),
    listAccounts(company.id),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const counts = { CUSTOMER: 0, VENDOR: 0 } as Record<string, number>;
  for (const n of allNotes) counts[n.type] = (counts[n.type] ?? 0) + 1;

  const filtered = allNotes
    .filter((n) => !type || n.type === type)
    .filter((n) => (!from || n.issueDate >= from) && (!to || n.issueDate <= to))
    .slice(0, 100);

  const partyNames = new Map<string, string>();
  await Promise.all(
    filtered.map(async (n) => {
      if (n.customerId) partyNames.set(n.customerId, (await getCustomer(company.id, n.customerId))?.name ?? "—");
      if (n.vendorId) partyNames.set(n.vendorId, (await getVendor(company.id, n.vendorId))?.name ?? "—");
    }),
  );

  const creditNotes = filtered.map((n) => ({
    ...n,
    customer: n.customerId ? { id: n.customerId, name: partyNames.get(n.customerId) ?? "—" } : null,
    vendor: n.vendorId ? { id: n.vendorId, name: partyNames.get(n.vendorId) ?? "—" } : null,
    lines: n.lines.map((l) => ({
      ...l,
      account: accountById.get(l.accountId) ?? { code: "", name: "" },
    })),
  }));

  const openCents = creditNotes.reduce((s, c) => s + c.balanceCents, 0);

  return (
    <>
      <PageHeader
        title="Credit notes"
        breadcrumb={[{ label: "Sales", href: "/sales/invoices" }, { label: "Credit notes" }]}
        description={`${formatMoney(openCents, { currency })} of unapplied credit. A credit note reverses revenue and the tax that went with it, then sits against the party until it is applied.`}
        actions={
          <LinkButton href="/sales/credit-notes/new" variant="primary">
            <Icon name="plus" className="h-3.5 w-3.5" />
            New credit note
          </LinkButton>
        }
      />

      <FilterBar
        paramName="type"
        tabs={[
          { label: "All", value: "" },
          { label: "Customer credits", value: "CUSTOMER", count: counts.CUSTOMER ?? 0 },
          { label: "Vendor credits", value: "VENDOR", count: counts.VENDOR ?? 0 },
        ]}
        extra={<DateRangeFilter label="Credit date" />}
      />

      <Card className="p-5">
        {creditNotes.length === 0 ? (
          <EmptyState
            title="No credit notes match"
            description={
              type || issuedBetween
                ? "Try clearing the filters or widening the date range."
                : "Issue a credit note when work is reduced or a customer is over-billed — it reverses the revenue and the tax rather than editing the original invoice."
            }
            action={
              <LinkButton href="/sales/credit-notes/new" variant="primary">
                New credit note
              </LinkButton>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="7rem">Number</Th>
                <Th width="6.5rem">Date</Th>
                <Th>Party</Th>
                <Th>Reason</Th>
                <Th width="8rem" align="right">Total</Th>
                <Th width="8rem" align="right">Unapplied</Th>
                <Th width="8rem">Status</Th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.map((note) => {
                const party = note.customer ?? note.vendor;
                const href = note.customer ? `/sales/customers/${note.customer.id}` : `/purchases/vendors/${note.vendor?.id}`;
                return (
                  <Tr key={note.id}>
                    <Td>
                      {note.journalEntryId ? (
                        <Link href={`/accounting/journals/${note.journalEntryId}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                          {note.number}
                        </Link>
                      ) : (
                        <span className="tnum font-medium">{note.number}</span>
                      )}
                    </Td>
                    <Td className="text-muted-ink">{formatDate(note.issueDate)}</Td>
                    <Td>
                      {party ? (
                        <Link href={href} className="hover:text-brand-700 hover:underline">{party.name}</Link>
                      ) : (
                        "—"
                      )}
                      <span className="block text-[0.6875rem] uppercase tracking-[0.04em] text-muted-ink">
                        {note.type.toLowerCase()} credit
                      </span>
                    </Td>
                    <Td className="text-muted-ink">
                      {note.reason ?? note.memo ?? "—"}
                      <span className="block text-[0.75rem]">
                        {note.lines.map((line) => line.account.name).join(", ")}
                      </span>
                    </Td>
                    <Td align="right"><Money cents={note.totalCents} /></Td>
                    <Td align="right"><Money cents={note.balanceCents} bold blankZero /></Td>
                    <Td><StatusBadge status={note.status} /></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
