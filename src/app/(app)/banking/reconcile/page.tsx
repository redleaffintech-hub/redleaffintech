import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { buildWorkspace, lastCompletedReconciliation, reconciliationHistory } from "@/server/banking/reconcile";
import { today, isoDate, toUtcDay } from "@/lib/dates";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ReconcileClient } from "./reconcile-workspace";

export const metadata = { title: "Reconcile" };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReconcilePage({ searchParams }: PageProps<"/banking/reconcile">) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  const currency = company.baseCurrency;
  const params = await searchParams;

  const bankAccounts = await db.bankAccount.findMany({
    where: { companyId: company.id, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, type: true, accountNumberMasked: true },
  });

  if (bankAccounts.length === 0) {
    return (
      <>
        <PageHeader title="Reconcile" breadcrumb={[{ label: "Banking", href: "/banking/accounts" }, { label: "Reconcile" }]} />
        <EmptyState
          title="No bank accounts"
          description="A Chart of Accounts entry alone isn't reconcilable — link one under Banking → Bank Accounts first."
          action={<LinkButton href="/banking/accounts" variant="primary">Go to Bank Accounts</LinkButton>}
        />
      </>
    );
  }

  // The account comes from the URL but is only ever used if it is one of this company's.
  const accountId =
    typeof params.account === "string" && bankAccounts.some((b) => b.id === params.account)
      ? params.account
      : bankAccounts[0].id;

  const dateIso =
    typeof params.date === "string" && ISO_DAY.test(params.date) ? isoDate(toUtcDay(params.date)) : isoDate(today());

  const [existing, lastCompleted, queueCount, history] = await Promise.all([
    db.bankReconciliation.findFirst({
      where: { companyId: company.id, bankAccountId: accountId, statementDate: toUtcDay(dateIso) },
      select: { id: true },
    }),
    lastCompletedReconciliation(company.id, accountId),
    db.bankTransaction.count({ where: { companyId: company.id, status: "UNMATCHED", reconciliationId: null } }),
    reconciliationHistory(company.id),
  ]);

  const workspace = existing ? await buildWorkspace(company.id, existing.id) : null;

  return (
    <>
      <PageHeader
        title="Reconcile"
        breadcrumb={[{ label: "Banking", href: "/banking/accounts" }, { label: "Reconcile" }]}
        description="Match the bank statement to the general ledger and close the reconciliation when the difference is zero."
      />

      <ReconcileClient
        currency={currency}
        canWrite={!company.isReadOnly}
        bankAccounts={bankAccounts}
        accountId={accountId}
        dateIso={dateIso}
        carryOpeningCents={lastCompleted ? lastCompleted.closingBalanceCents : null}
        lastCompletedIso={lastCompleted ? isoDate(lastCompleted.statementDate) : null}
        queueCount={queueCount}
        workspace={workspace}
        history={history.map((h) => ({
          id: h.id,
          bankAccountId: h.bankAccountId,
          bankAccountName: h.bankAccount.name,
          dateIso: isoDate(h.statementDate),
          status: h.status,
          closingBalanceCents: h.closingBalanceCents,
          differenceCents: h.differenceCents,
        }))}
      />
    </>
  );
}
