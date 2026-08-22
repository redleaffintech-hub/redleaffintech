import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { recalculate } from "@/server/banking/reconcile";
import { accountBalance } from "@/server/reports/financials";
import { formatDate, isoDate, today, endOfMonth, startOfMonth, addMonths } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Badge, Card, CardHeader, EmptyState, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { ReconcileWorkspace, StartReconciliationForm } from "./reconcile-workspace";

export const metadata = { title: "Reconcile" };

export default async function ReconcilePage({ searchParams }: PageProps<"/banking/reconcile">) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  const params = await searchParams;

  const bankAccounts = await db.bankAccount.findMany({
    where: { companyId: company.id, isActive: true },
    orderBy: { name: "asc" },
  });

  const inProgress = await db.bankReconciliation.findFirst({
    where: { companyId: company.id, status: "IN_PROGRESS" },
    include: { bankAccount: true },
  });

  if (inProgress) {
    const state = await recalculate(company.id, inProgress.id);
    const transactions = await db.bankTransaction.findMany({
      where: {
        companyId: company.id,
        bankAccountId: inProgress.bankAccountId,
        date: { lte: inProgress.statementEndDate },
        status: { notIn: ["EXCLUDED"] },
        OR: [{ reconciliationId: null }, { reconciliationId: inProgress.id }],
      },
      orderBy: { date: "asc" },
    });

    return (
      <>
        <PageHeader
          title={`Reconcile ${inProgress.bankAccount.name}`}
          breadcrumb={[{ label: "Banking", href: "/banking" }, { label: "Reconcile" }]}
          description={`Statement ${formatDate(inProgress.statementStartDate)} to ${formatDate(inProgress.statementEndDate)}. Tick every line that appears on the statement until the difference reaches zero.`}
        />
        <ReconcileWorkspace
          reconciliationId={inProgress.id}
          state={{
            openingBalanceCents: state.openingBalanceCents,
            closingBalanceCents: state.closingBalanceCents,
            clearedDepositsCents: state.clearedDepositsCents,
            clearedWithdrawalsCents: state.clearedWithdrawalsCents,
            clearedCountDeposits: state.clearedCountDeposits,
            clearedCountWithdrawals: state.clearedCountWithdrawals,
            clearedBalanceCents: state.clearedBalanceCents,
            differenceCents: state.differenceCents,
          }}
          transactions={transactions.map((t) => ({
            id: t.id,
            date: formatDate(t.date),
            description: t.description,
            amountCents: t.amountCents,
            cleared: t.reconciliationId === inProgress.id,
            posted: Boolean(t.journalEntryId),
          }))}
        />
      </>
    );
  }

  const history = await db.bankReconciliation.findMany({
    where: { companyId: company.id, status: "COMPLETED" },
    include: { bankAccount: true },
    orderBy: { statementEndDate: "desc" },
    take: 10,
  });

  const suggestedAccountId = typeof params.account === "string" ? params.account : bankAccounts[0]?.id;
  const suggested = bankAccounts.find((b) => b.id === suggestedAccountId) ?? bankAccounts[0];
  const lastFor = suggested
    ? await db.bankReconciliation.findFirst({
        where: { companyId: company.id, bankAccountId: suggested.id, status: "COMPLETED" },
        orderBy: { statementEndDate: "desc" },
      })
    : null;

  const openingCents = lastFor
    ? lastFor.closingBalanceCents
    : suggested
      ? suggested.openingBalanceCents
      : 0;

  const lastMonth = startOfMonth(addMonths(today(), -1));
  const bookBalanceCents = suggested ? await accountBalance(company.id, suggested.accountId, endOfMonth(lastMonth)) : 0;

  return (
    <>
      <PageHeader
        title="Bank reconciliation"
        breadcrumb={[{ label: "Banking", href: "/banking" }, { label: "Reconcile" }]}
        description="A reconciliation can only be completed when the difference between the statement and the cleared book balance is exactly zero."
      />

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr] lg:items-start">
        {bankAccounts.length === 0 ? (
          <EmptyState title="No bank accounts" description="Add a bank account before reconciling." />
        ) : (
          <StartReconciliationForm
            bankAccounts={bankAccounts.map((b) => ({ id: b.id, name: b.name }))}
            defaultBankAccountId={suggested?.id ?? ""}
            defaultStart={isoDate(lastFor ? lastFor.statementEndDate : lastMonth)}
            defaultEnd={isoDate(endOfMonth(lastMonth))}
            defaultOpening={(openingCents / 100).toFixed(2)}
            suggestedClosing={(bookBalanceCents / 100).toFixed(2)}
          />
        )}

        <Card className="p-5">
          <CardHeader title="Completed reconciliations" subtitle="Locked once finished" />
          {history.length === 0 ? (
            <EmptyState title="Nothing reconciled yet" description="Complete a reconciliation to build the history." />
          ) : (
            <Table className="mt-3">
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th width="14rem">Statement period</Th>
                  <Th width="9rem" align="right">Closing balance</Th>
                  <Th width="8rem" align="right">Difference</Th>
                  <Th width="7rem">Status</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((reconciliation) => (
                  <Tr key={reconciliation.id}>
                    <Td className="font-medium text-ink-900">{reconciliation.bankAccount.name}</Td>
                    <Td className="text-muted-ink">
                      {formatDate(reconciliation.statementStartDate)} – {formatDate(reconciliation.statementEndDate)}
                    </Td>
                    <Td align="right"><Money cents={reconciliation.closingBalanceCents} /></Td>
                    <Td align="right"><Money cents={reconciliation.differenceCents} /></Td>
                    <Td>
                      <Badge tone="positive">reconciled</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
