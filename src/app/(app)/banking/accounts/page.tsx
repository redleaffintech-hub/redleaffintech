import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { accountBalance } from "@/server/reports/financials";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { Badge, Card, LinkButton, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { EditBankAccountButton } from "./edit-bank-account";

export const metadata = { title: "Bank accounts" };

export default async function BankAccountsPage() {
  const { company, role } = await requireCapability(CAPABILITIES.BANKING);
  const canEdit = can(role, CAPABILITIES.BANKING);

  const [bankAccounts, glAccounts] = await Promise.all([
    db.bankAccount.findMany({
      where: { companyId: company.id },
      include: {
        account: true,
        reconciliations: { where: { status: "COMPLETED" }, orderBy: { statementEndDate: "desc" }, take: 1 },
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
      return {
        bankAccount,
        // Credit cards are credit-natural: a positive balance means money owed.
        balanceCents: bankAccount.type === "CREDIT_CARD" ? -signed : signed,
        unreconciled,
      };
    }),
  );

  return (
    <>
      <PageHeader
        title="Bank & card accounts"
        breadcrumb={[{ label: "Bank Reconciliation", href: "/banking" }, { label: "Accounts" }]}
        description="Each account is bound to a general-ledger account, so the balance here and the balance sheet are the same number."
        actions={<LinkButton href="/banking/reconcile" variant="primary">Reconcile an account</LinkButton>}
      />

      <Card className="p-5">
        <Table>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th width="10rem">GL account</Th>
              <Th width="8rem">Feed</Th>
              <Th width="7rem" align="right">Transactions</Th>
              <Th width="10rem">Last reconciled</Th>
              <Th width="10rem" align="right">Balance</Th>
              {canEdit && <Th width="4rem" align="right">{""}</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ bankAccount, balanceCents, unreconciled }) => (
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
                <Td className="text-muted-ink">
                  {bankAccount.reconciliations[0]
                    ? formatDate(bankAccount.reconciliations[0].statementEndDate)
                    : "Never"}
                </Td>
                <Td align="right"><Money cents={balanceCents} bold /></Td>
                {canEdit && (
                  <Td align="right">
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
    </>
  );
}
