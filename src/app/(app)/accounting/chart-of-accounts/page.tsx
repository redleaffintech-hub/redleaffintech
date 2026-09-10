import Link from "next/link";
import { listAccounts } from "@/server/db/accounts";
import { listLinesUpTo } from "@/server/db/journal-entries";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { estimates as estimatesRepo } from "@/server/db/estimates";
import { creditNotes as creditNotesRepo } from "@/server/db/credit-notes";
import { bills as billsRepo } from "@/server/db/bills";
import { expenses as expensesRepo } from "@/server/db/expenses";
import { budgets as budgetsRepo } from "@/server/db/supporting";
import { bankAccounts as bankAccountsRepo } from "@/server/db/banking";
import { listItems } from "@/server/db/items";
import { listTaxCodes } from "@/server/db/tax-codes";
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

  const q = query.toLowerCase();
  const [allAccounts, lines, invoiceDocs, estimateDocs, creditNoteDocs, billDocs, expenseDocs, budgetDocs, banks, items, taxCodes] =
    await Promise.all([
      listAccounts(company.id),
      listLinesUpTo(company.id, today()),
      invoicesRepo.list(company.id),
      estimatesRepo.list(company.id),
      creditNotesRepo.list(company.id),
      billsRepo.list(company.id),
      expensesRepo.list(company.id),
      budgetsRepo.list(company.id),
      bankAccountsRepo.list(company.id),
      listItems(company.id),
      listTaxCodes(company.id),
    ]);

  const accounts = allAccounts
    .filter((a) => !typeFilter || a.type === typeFilter)
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));

  const balanceById = new Map<string, { debit: number; credit: number; count: number }>();
  for (const line of lines) {
    const cur = balanceById.get(line.accountId) ?? { debit: 0, credit: 0, count: 0 };
    cur.debit += line.debitCents;
    cur.credit += line.creditCents;
    cur.count += 1;
    balanceById.set(line.accountId, cur);
  }

  // A presence check for the Delete button — the server action re-verifies the
  // real count before deleting anything, this only decides whether to show it.
  const referencedIds = new Set<string>();
  for (const line of lines) referencedIds.add(line.accountId);
  for (const docs of [invoiceDocs, estimateDocs, creditNoteDocs, billDocs, expenseDocs, budgetDocs]) {
    for (const d of docs) for (const l of d.lines ?? []) referencedIds.add(l.accountId);
  }
  for (const b of banks) if (b.accountId) referencedIds.add(b.accountId);
  for (const i of items) {
    if (i.incomeAccountId) referencedIds.add(i.incomeAccountId);
    if (i.expenseAccountId) referencedIds.add(i.expenseAccountId);
  }
  for (const c of taxCodes) {
    for (const comp of c.components ?? []) {
      if (comp.liabilityAccountId) referencedIds.add(comp.liabilityAccountId);
      if (comp.recoverableAccountId) referencedIds.add(comp.recoverableAccountId);
    }
  }
  for (const a of allAccounts) if (a.parentId) referencedIds.add(a.parentId);

  const grouped = ACCOUNT_TYPES.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  })).filter((group) => group.accounts.length > 0);

  const typeCount = new Map<string, number>();
  for (const a of allAccounts) typeCount.set(a.type, (typeCount.get(a.type) ?? 0) + 1);
  const countOf = (type: string) => typeCount.get(type) ?? 0;

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
