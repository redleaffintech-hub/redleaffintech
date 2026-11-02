import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { accountBalance } from "@/server/reports/financials";
import { formatDate, isoDate, today } from "@/lib/dates";
import { Badge, Callout, Card, EmptyState, LinkButton, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

import { EditBankAccountButton } from "./edit-bank-account";
import { AddBankAccountButton } from "./add-bank-account";

export const metadata = { title: "Bank accounts" };

export default async function BankAccountsPage({ searchParams }: PageProps<"/banking/accounts">) {
  const { company, role } = await requireCapability(CAPABILITIES.BANKING);
  const params = await searchParams;
  const canEdit = can(role, CAPABILITIES.BANKING);

  const [bankAccounts, glAccounts] = await Promise.all([
    db.bankAccount.findMany({
      where: { companyId: company.id },
      include: {
        account: true,
        reconciliations: { where: { status: "COMPLETED" }, orderBy: { statementDate: "desc" }, take: 1 },
        _count: { select: { transactions: true, reconciliations: true } },
      },
      orderBy: { name: "asc" },
    }),
    // Both sides of a possible relink: assets for BANK/CASH, liabilities for
    // CREDIT_CARD. The edit dialog filters to what the selected type allows.
    db.account.findMany({
      where: { companyId: company.id, isActive: true, type: { in: ["ASSET", "LIABILITY"] } },
      select: { id: true, code: true, name: true, type: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const asOf = today();
  const rows = await Promise.all(
    bankAccounts.map(async (bankAccount) => {
      const signed = await accountBalance(company.id, bankAccount.accountId, asOf);
      const unreconciled = await db.bankTransaction.count({
        where: { companyId: company.id, bankAccountId: bankAccount.id, status: { notIn: ["RECONCILED", "EXCLUDED"] } },
      });

      // Reconciled means the latest completed reconciliation still describes the
      // ledger: nothing has posted to the bank account since its date, and nothing
      // was entered afterwards with an earlier date.
      const last = bankAccount.reconciliations[0] ?? null;
      // A reconciliation started and saved but not completed: the account is picked up from here.
      const inProgress = await db.bankReconciliation.findFirst({
        where: { companyId: company.id, bankAccountId: bankAccount.id, status: "IN_PROGRESS" },
        orderBy: { createdAt: "desc" },
        select: { statementDate: true },
      });
      let reconciled = false;
      if (last) {
        const since = await db.journalLine.count({
          where: {
            companyId: company.id,
            accountId: bankAccount.accountId,
            journalEntry: { status: "POSTED", reversalOfId: null },
            OR: [
              { date: { gt: last.statementDate } },
              ...(last.completedAt ? [{ journalEntry: { createdAt: { gt: last.completedAt } } }] : []),
            ],
          },
        });
        reconciled = last.differenceCents === 0 && since === 0;
      }
      return {
        bankAccount,
        last,
        inProgressDateIso: inProgress ? isoDate(inProgress.statementDate) : null,
        reconciled,
        // Credit cards are credit-natural: a positive balance means money owed.
        balanceCents: bankAccount.type === "CREDIT_CARD" ? -signed : signed,
        unreconciled,
      };
    }),
  );

  return (
    <>
      <PageHeader
        title="Bank Accounts"
        breadcrumb={[{ label: "Banking", href: "/banking/accounts" }, { label: "Bank Accounts" }]}
        description="Each account is bound to a general-ledger account, so the balance here and the balance sheet are the same number."
        actions={
          <div className="flex items-center gap-2">
            {rows.length > 0 && (
              <LinkButton href="/banking/reconcile">Reconcile</LinkButton>
            )}
            {canEdit && <AddBankAccountButton glAccounts={glAccounts} currency={company.baseCurrency} />}
          </div>
        }
      />

      {params.saved === "reconciliation" && (
        <Callout tone="positive" title="Reconciliation saved">
          Your matches and statement figures are saved. Open Reconcile, or press Resume on the account, to continue from where you stopped.
        </Callout>
      )}

      {rows.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            title="No bank or card accounts yet"
            description={
              canEdit
                ? "A Chart of Accounts entry alone isn't reconcilable — link one here to start importing statements and matching transactions."
                : "Ask someone with banking access to link a Chart of Accounts entry here before reconciliation can be used."
            }
          />
        </Card>
      ) : (
      <Card className="p-5">
        <Table>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th width="10rem">GL account</Th>
              <Th width="8rem">Feed</Th>
              <Th width="7rem" align="right">Transactions</Th>
              <Th width="10rem">Last reconciled</Th>
              <Th width="10rem">Bank vs GL</Th>
              <Th width="10rem" align="right">Balance</Th>
              {canEdit && <Th width="9rem" align="right">{""}</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ bankAccount, last, inProgressDateIso, reconciled, balanceCents, unreconciled }) => (
              <Tr key={bankAccount.id}>
                <Td>
                  <span className="font-medium text-ink-900">{bankAccount.name}</span>
                  <span className="block text-[0.75rem] text-muted-ink">
                    {bankAccount.institution} {bankAccount.accountNumberMasked} ·{" "}
                    {bankAccount.type.replace(/_/g, " ").toLowerCase()}
                  </span>
                </Td>
                <Td className="text-muted-ink">
                  {bankAccount.account.code} · {bankAccount.account.name}
                </Td>
                <Td>
                  <Badge tone={bankAccount.feedStatus === "CONNECTED" ? "positive" : "neutral"}>
                    {bankAccount.feedStatus.toLowerCase()}
                  </Badge>
                  {bankAccount.lastImportAt && (
                    <span className="block text-[0.6875rem] text-muted-ink">
                      {formatDate(bankAccount.lastImportAt)}
                    </span>
                  )}
                </Td>
                <Td align="right" className="tnum">
                  {bankAccount._count.transactions}
                  {unreconciled > 0 && (
                    <span className="block text-[0.6875rem] text-caution">{unreconciled} unreconciled</span>
                  )}
                </Td>
                <Td className="text-muted-ink">{last ? formatDate(last.statementDate) : "Never"}</Td>
                <Td>
                  {inProgressDateIso ? (
                    <Badge tone="caution">In progress</Badge>
                  ) : !last ? (
                    <Badge tone="neutral">Never reconciled</Badge>
                  ) : reconciled ? (
                    <Badge tone="positive">Reconciled</Badge>
                  ) : (
                    <Badge tone="caution">Not reconciled</Badge>
                  )}
                  {inProgressDateIso && (
                    <span className="block text-[0.6875rem] text-muted-ink">Saved · as of {formatDate(inProgressDateIso)}</span>
                  )}
                  {!inProgressDateIso && last && !reconciled && (
                    <span className="block text-[0.6875rem] text-muted-ink">GL activity since {formatDate(last.statementDate)}</span>
                  )}
                </Td>
                <Td align="right"><Money cents={balanceCents} bold /></Td>
                {canEdit && (
                  <Td align="right">
                    <Link
                      href={`/banking/reconcile?account=${bankAccount.id}${inProgressDateIso ? `&date=${inProgressDateIso}` : ""}`}
                      className="mr-3 text-[0.8125rem] font-medium text-brand-700 hover:underline"
                    >
                      {inProgressDateIso ? "Resume" : "Reconcile"}
                    </Link>
                    <EditBankAccountButton
                      account={{
                        id: bankAccount.id,
                        name: bankAccount.name,
                        institution: bankAccount.institution ?? "",
                        accountNumberMasked: bankAccount.accountNumberMasked ?? "",
                        type: bankAccount.type,
                        currency: bankAccount.currency,
                        accountId: bankAccount.accountId,
                        isActive: bankAccount.isActive,
                        locked: bankAccount._count.transactions > 0 || bankAccount._count.reconciliations > 0,
                      }}
                      glAccounts={glAccounts}
                    />
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>

        <p className="mt-4 text-[0.75rem] leading-5 text-muted-ink">
          The provider column is an abstraction seam: the same import, matching and reconciliation code runs whether a
          transaction arrived from a CSV, an OFX file or a live open-banking feed.
        </p>
      </Card>
      )}
    </>
  );
}
