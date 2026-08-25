import Link from "next/link";
import { db } from "@/lib/db";
import { contains } from "@/lib/search";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, NORMAL_BALANCE, type AccountType } from "@/lib/enums";
import { today } from "@/lib/dates";
import { Badge, Card, LinkButton, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { ExportCsvButton } from "@/components/export-csv-button";
import { Icon } from "@/components/shell/icons";
import { SubtypePicker } from "./subtype-picker";
import { AccountRowActions, NewAccountButton } from "./account-dialog";

export const metadata = { title: "Chart of accounts" };

const TYPE_LABEL: Record<AccountType, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expenses",
};

export default async function ChartOfAccountsPage({ searchParams }: PageProps<"/accounting/chart-of-accounts">) {
  const { company, role } = await requireCapability(CAPABILITIES.COA);
  // Classification decides which side of EBITDA an expense falls on, so it is
  // gated on the same capability that governs the chart itself.
  const canReclassify = can(role, CAPABILITIES.COA);
  const params = await searchParams;
  const typeFilter = typeof params.type === "string" ? params.type : "";
  const query = typeof params.q === "string" ? params.q : "";

  const [accounts, balances] = await Promise.all([
    db.account.findMany({
      where: {
        companyId: company.id,
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(query ? { OR: [{ name: contains(query) }, { code: contains(query) }] } : {}),
      },
      orderBy: { code: "asc" },
    }),
    db.journalLine.groupBy({
      by: ["accountId"],
      where: { companyId: company.id, date: { lte: today() } },
      _sum: { debitCents: true, creditCents: true },
      _count: true,
    }),
  ]);

  const balanceById = new Map(
    balances.map((b) => [b.accountId, { debit: b._sum.debitCents ?? 0, credit: b._sum.creditCents ?? 0, count: b._count }]),
  );

  // A cheap presence check for the Delete button: one query per source table
  // that can reference an account, unioned into a set, rather than one query
  // per account. The server action re-verifies the real count before ever
  // deleting anything — this only decides whether the button is worth showing.
  const [
    journalAccountIds, docAccountIds, budgetAccountIds, bankAccountIds,
    itemAccountIds, taxComponentAccountIds, parentAccountIds,
  ] = await Promise.all([
    db.journalLine.findMany({ where: { companyId: company.id }, select: { accountId: true }, distinct: ["accountId"] }),
    Promise.all([
      db.invoiceLine.findMany({ where: { invoice: { companyId: company.id } }, select: { accountId: true }, distinct: ["accountId"] }),
      db.estimateLine.findMany({ where: { estimate: { companyId: company.id } }, select: { accountId: true }, distinct: ["accountId"] }),
      db.creditNoteLine.findMany({ where: { creditNote: { companyId: company.id } }, select: { accountId: true }, distinct: ["accountId"] }),
      db.billLine.findMany({ where: { bill: { companyId: company.id } }, select: { accountId: true }, distinct: ["accountId"] }),
      db.expenseLine.findMany({ where: { expense: { companyId: company.id } }, select: { accountId: true }, distinct: ["accountId"] }),
    ]).then((groups) => groups.flat()),
    db.budgetLine.findMany({ where: { budget: { companyId: company.id } }, select: { accountId: true }, distinct: ["accountId"] }),
    db.bankAccount.findMany({ where: { companyId: company.id }, select: { accountId: true } }),
    db.serviceItem.findMany({
      where: { companyId: company.id },
      select: { incomeAccountId: true, expenseAccountId: true },
    }),
    db.taxComponent.findMany({
      where: { taxCode: { companyId: company.id } },
      select: { liabilityAccountId: true, recoverableAccountId: true },
    }),
    db.account.findMany({ where: { companyId: company.id, parentId: { not: null } }, select: { parentId: true } }),
  ]);
  const referencedIds = new Set<string>();
  for (const r of journalAccountIds) referencedIds.add(r.accountId);
  for (const r of docAccountIds) referencedIds.add(r.accountId);
  for (const r of budgetAccountIds) referencedIds.add(r.accountId);
  for (const r of bankAccountIds) referencedIds.add(r.accountId);
  for (const r of itemAccountIds) { if (r.incomeAccountId) referencedIds.add(r.incomeAccountId); if (r.expenseAccountId) referencedIds.add(r.expenseAccountId); }
  for (const r of taxComponentAccountIds) { if (r.liabilityAccountId) referencedIds.add(r.liabilityAccountId); if (r.recoverableAccountId) referencedIds.add(r.recoverableAccountId); }
  for (const r of parentAccountIds) { if (r.parentId) referencedIds.add(r.parentId); }

  const grouped = ACCOUNT_TYPES.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  })).filter((group) => group.accounts.length > 0);

  const counts = await db.account.groupBy({ by: ["type"], where: { companyId: company.id }, _count: true });
  const countOf = (type: string) => counts.find((c) => c.type === type)?._count ?? 0;

  return (
    <>
      <PageHeader
        title="Chart of accounts"
        breadcrumb={[{ label: "Accounting" }, { label: "Chart of accounts" }]}
        description="Canadian service-business starter chart. Control accounts marked as system accounts are written to by the posting engine and cannot be deleted."
        actions={
          <>
            <ExportCsvButton report="chart-of-accounts" />
            <LinkButton href="/accounting/chart-of-accounts/opening-balances">Opening balances</LinkButton>
            <NewAccountButton />
          </>
        }
      />

      <FilterBar
        paramName="type"
        searchPlaceholder="Search code or name…"
        tabs={[
          { label: "All", value: "" },
          ...ACCOUNT_TYPES.map((type) => ({ label: TYPE_LABEL[type], value: type, count: countOf(type) })),
        ]}
      />

      <div className="space-y-4">
        {grouped.map((group) => (
          <Card key={group.type} className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-[0.9375rem] font-semibold text-ink-900">{TYPE_LABEL[group.type]}</h2>
              <span className="text-[0.75rem] text-muted-ink">
                normal balance {NORMAL_BALANCE[group.type].toLowerCase()}
              </span>
            </div>
            <Table>
              <thead>
                <tr>
                  <Th width="5rem">Code</Th>
                  <Th>Account</Th>
                  <Th width="12rem">Classification</Th>
                  <Th width="6rem" align="right">Entries</Th>
                  <Th width="9rem" align="right">Balance</Th>
                  {canReclassify && <Th width="10rem" align="right">{""}</Th>}
                </tr>
              </thead>
              <tbody>
                {group.accounts.map((account) => {
                  const stats = balanceById.get(account.id);
                  const debit = stats?.debit ?? 0;
                  const credit = stats?.credit ?? 0;
                  const balance = NORMAL_BALANCE[group.type] === "DEBIT" ? debit - credit : credit - debit;
                  return (
                    <Tr key={account.id}>
                      <Td className="tnum text-muted-ink">{account.code}</Td>
                      <Td>
                        <Link
                          href={`/accounting/general-ledger?account=${account.id}`}
                          className="font-medium text-ink-900 hover:text-brand-700 hover:underline"
                        >
                          {account.name}
                        </Link>
                        {account.description && (
                          <span className="block text-[0.75rem] text-muted-ink">{account.description}</span>
                        )}
                      </Td>
                      <Td>
                        <SubtypePicker
                          accountId={account.id}
                          subtype={account.subtype}
                          options={ACCOUNT_SUBTYPES[account.type as AccountType] ?? [account.subtype]}
                          disabled={!canReclassify}
                        />
                        {account.isSystem && (
                          <Badge tone="accent" className="ml-1.5">
                            <Icon name="lock" className="h-2.5 w-2.5" />
                            system
                          </Badge>
                        )}
                        {!account.isActive && <Badge className="ml-1.5">archived</Badge>}
                      </Td>
                      <Td align="right" className="tnum text-muted-ink">{stats?.count ?? 0}</Td>
                      <Td align="right"><Money cents={balance} bold={balance !== 0} blankZero /></Td>
                      {canReclassify && (
                        <Td align="right">
                          <AccountRowActions
                            account={{
                              id: account.id,
                              code: account.code,
                              name: account.name,
                              type: account.type as AccountType,
                              subtype: account.subtype,
                              description: account.description ?? "",
                              isActive: account.isActive,
                              isSystem: account.isSystem,
                            }}
                            referenced={referencedIds.has(account.id)}
                          />
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-[0.75rem] leading-5 text-muted-ink">
        Accounts are archived rather than deleted so historical transactions keep their references intact. A CPA should
        review this chart before it is used for filing.
      </p>
    </>
  );
}
