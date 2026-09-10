import Link from "next/link";
import { expenses as expensesRepo } from "@/server/db/expenses";
import { getVendor } from "@/server/db/vendors";
import { listAccounts } from "@/server/db/accounts";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { fiscalYearOf, fiscalYearRange, isoDate, toUtcDay, today, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Card, EmptyState, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, Tr } from "@/components/ui";
import { FilterBar, RangePicker } from "@/components/filter-bar";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const { company } = await requireCapability(CAPABILITIES.EXPENSES);
  const currency = company.baseCurrency;
  const params = await searchParams;

  const defaults = fiscalYearRange(fiscalYearOf(today(), company.fiscalYearStartMonth), company.fiscalYearStartMonth);
  const from = toUtcDay(typeof params.from === "string" ? params.from : isoDate(defaults.start));
  const to = toUtcDay(typeof params.to === "string" ? params.to : isoDate(today()));
  const status = typeof params.status === "string" ? params.status : "";
  const query = typeof params.q === "string" ? params.q : "";

  const q = query.toLowerCase();
  const [allExpenses, accounts] = await Promise.all([
    expensesRepo.list(company.id, { orderBy: "date", direction: "desc" }),
    listAccounts(company.id),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const inPeriod = allExpenses.filter((e) => e.date >= from && e.date <= to);
  const statusCount = new Map<string, number>();
  for (const e of inPeriod) statusCount.set(e.status, (statusCount.get(e.status) ?? 0) + 1);
  const countOf = (s: string) => statusCount.get(s) ?? 0;

  const filtered = inPeriod
    .filter((e) => !status || e.status === status)
    .filter(
      (e) =>
        !q ||
        e.number.toLowerCase().includes(q) ||
        (e.payeeName ?? "").toLowerCase().includes(q) ||
        (e.memo ?? "").toLowerCase().includes(q),
    )
    .slice(0, 150);

  const vendorNames = new Map<string, string>();
  await Promise.all(
    [...new Set(filtered.map((e) => e.vendorId).filter((x): x is string => Boolean(x)))].map(async (id) => {
      vendorNames.set(id, (await getVendor(company.id, id))?.name ?? "—");
    }),
  );

  const expenses = filtered.map((e) => ({
    ...e,
    vendor: e.vendorId ? { id: e.vendorId, name: vendorNames.get(e.vendorId) ?? "—" } : null,
    lines: e.lines.map((l) => ({
      ...l,
      account: accountById.get(l.accountId) ?? { code: "", name: "" },
    })),
  }));
  const totalCents = expenses.filter((e) => e.status !== "VOID").reduce((s, e) => s + e.totalCents, 0);
  const taxCents = expenses.filter((e) => e.status !== "VOID").reduce((s, e) => s + e.taxCents, 0);

  return (
    <>
      <PageHeader
        title="Expenses"
        description={`${formatMoney(totalCents, { currency })} recorded in this period, including ${formatMoney(taxCents, { currency })} of sales tax. Expenses are money paid directly — anything invoiced by a supplier belongs on a bill.`}
        actions={
          <LinkButton href="/expenses/new" variant="primary">
            <Icon name="plus" className="h-3.5 w-3.5" />
            New expense
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangePicker from={isoDate(from)} to={isoDate(to)} />
      </div>

      <FilterBar
        searchPlaceholder="Search number, payee or memo…"
        tabs={[
          { label: "All", value: "" },
          { label: "Posted", value: "POSTED", count: countOf("POSTED") },
          { label: "Awaiting approval", value: "AWAITING_APPROVAL", count: countOf("AWAITING_APPROVAL") },
          { label: "Drafts", value: "DRAFT", count: countOf("DRAFT") },
          { label: "Void", value: "VOID", count: countOf("VOID") },
        ]}
      />

      <Card className="p-5">
        {expenses.length === 0 ? (
          <EmptyState
            title="No expenses in this period"
            description="Record a card or debit purchase, or categorise it straight from the bank review queue."
            action={<LinkButton href="/expenses/new" variant="primary">New expense</LinkButton>}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th width="7rem">Number</Th>
                <Th width="6.5rem">Date</Th>
                <Th>Payee</Th>
                <Th>Categorised to</Th>
                <Th width="7rem" align="right">Tax</Th>
                <Th width="8rem" align="right">Total</Th>
                <Th width="6.5rem">Status</Th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <Tr key={expense.id}>
                  <Td>
                    {expense.journalEntryId ? (
                      <Link href={`/accounting/journals/${expense.journalEntryId}`} className="tnum font-medium text-ink-900 hover:text-brand-700 hover:underline">
                        {expense.number}
                      </Link>
                    ) : (
                      <span className="tnum font-medium text-ink-900">{expense.number}</span>
                    )}
                  </Td>
                  <Td className="text-muted-ink">{formatDate(expense.date)}</Td>
                  <Td>
                    {expense.vendor ? (
                      <Link href={`/purchases/vendors/${expense.vendor.id}`} className="hover:text-brand-700 hover:underline">
                        {expense.vendor.name}
                      </Link>
                    ) : (
                      expense.payeeName ?? "—"
                    )}
                    {expense.memo && <span className="block truncate text-[0.75rem] text-muted-ink">{expense.memo}</span>}
                  </Td>
                  <Td className="text-muted-ink">
                    {expense.lines.map((line) => `${line.account.code} ${line.account.name}`).join(", ")}
                  </Td>
                  <Td align="right"><Money cents={expense.taxCents} blankZero /></Td>
                  <Td align="right"><Money cents={expense.totalCents} bold /></Td>
                  <Td><StatusBadge status={expense.status} /></Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Td colSpan={4} className="pt-3 font-medium text-ink-700">{expenses.length} expense(s)</Td>
                <Td align="right" className="pt-3"><Money cents={taxCents} bold /></Td>
                <Td align="right" className="pt-3"><Money cents={totalCents} bold /></Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
