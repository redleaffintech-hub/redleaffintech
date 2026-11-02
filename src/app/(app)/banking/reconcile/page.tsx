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
  const accountParam =
    typeof params.account === "string" && bankAccounts.some((b) => b.id === params.account) ? params.account : null;
  const dateParam = typeof params.date === "string" && ISO_DAY.test(params.date) ? isoDate(toUtcDay(params.date)) : null;

  let accountId = accountParam ?? bankAccounts[0].id;
  let dateIso = dateParam ?? isoDate(today());

  // Nothing chosen yet: pick up the reconciliation that was saved and left in progress,
  // so coming back the next day lands exactly where the work stopped.
  let resumed = false;
  if (!dateParam) {
    const saved = await db.bankReconciliation.findFirst({
      where: {
        companyId: company.id,
        status: "IN_PROGRESS",
        bankAccountId: accountParam ?? { in: bankAccounts.map((b) => b.id) },
      },
      orderBy: { createdAt: "desc" },
      select: { bankAccountId: true, statementDate: true },
    });
    if (saved) {
      accountId = saved.bankAccountId;
      dateIso = isoDate(saved.statementDate);
      resumed = true;
    }
  }

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
        resumed={resumed}
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
