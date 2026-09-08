import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { buildWorkspace, reconciliationHistory } from "@/server/banking/reconcile";
import { today, formatMonthLong } from "@/lib/dates";
import { EmptyState, PageHeader } from "@/components/ui";
import { ReconcileClient } from "./reconcile-workspace";

export const metadata = { title: "Bank Reconciliation" };

function toInt(value: unknown, fallback: number) {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export default async function ReconcilePage({ searchParams }: PageProps<"/banking/reconcile">) {
  const { company } = await requireCapability(CAPABILITIES.BANKING);
  const currency = company.baseCurrency;
  const params = await searchParams;

  const bankAccounts = await db.bankAccount.findMany({
    where: { companyId: company.id, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, openingBalanceCents: true },
  });

  if (bankAccounts.length === 0) {
    return (
      <>
        <PageHeader
          title="Bank Reconciliation"
          breadcrumb={[{ label: "Bank Reconciliation", href: "/banking" }, { label: "Reconcile" }]}
          description="Match bank statement activity to your bank ledger, one month at a time."
        />
        <EmptyState
          title="No bank accounts"
          description="Add a bank account under Bank Reconciliation → Accounts before reconciling."
        />
      </>
    );
  }

  const accountId =
    typeof params.account === "string" && bankAccounts.some((b) => b.id === params.account)
      ? params.account
      : bankAccounts[0].id;

  // Default to the month just gone — the one a bank statement most likely covers.
  const now = today();
  const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = toInt(params.year, priorMonth.getUTCFullYear());
  const month = toInt(params.month, priorMonth.getUTCMonth() + 1);
  const safeMonth = month >= 1 && month <= 12 ? month : priorMonth.getUTCMonth() + 1;

  const existing = await db.bankReconciliation.findFirst({
    where: {
      companyId: company.id,
      bankAccountId: accountId,
      statementYear: year,
      statementMonth: safeMonth,
    },
    select: { id: true },
  });

  let carryOpeningCents = bankAccounts.find((b) => b.id === accountId)?.openingBalanceCents ?? 0;
  if (!existing) {
    const prior = await db.bankReconciliation.findFirst({
      where: { companyId: company.id, bankAccountId: accountId, status: "COMPLETED" },
      orderBy: { statementEndDate: "desc" },
      select: { closingBalanceCents: true },
    });
    if (prior) carryOpeningCents = prior.closingBalanceCents;
  }

  const [workspace, history] = await Promise.all([
    existing ? buildWorkspace(company.id, existing.id) : Promise.resolve(null),
    reconciliationHistory(company.id),
  ]);

  return (
    <>
      <PageHeader
        title="Bank Reconciliation"
        breadcrumb={[{ label: "Bank Reconciliation", href: "/banking" }, { label: "Reconcile" }]}
        description="Match bank statement activity to your bank ledger, one month at a time."
      />

      <ReconcileClient
        currency={currency}
        canWrite={!company.isReadOnly}
        bankAccounts={bankAccounts.map((b) => ({ id: b.id, name: b.name }))}
        accountId={accountId}
        year={year}
        month={safeMonth}
        monthLabel={formatMonthLong(new Date(Date.UTC(year, safeMonth - 1, 1)))}
        carryOpeningCents={carryOpeningCents}
        workspace={workspace}
        history={history.map((h) => ({
          id: h.id,
          bankAccountId: h.bankAccountId,
          bankAccountName: h.bankAccount.name,
          year: h.statementYear,
          month: h.statementMonth,
          monthLabel: formatMonthLong(h.statementStartDate),
          status: h.status,
          closingBalanceCents: h.closingBalanceCents,
          differenceCents: h.differenceCents,
          completedAtIso: h.completedAt ? h.completedAt.toISOString() : null,
        }))}
      />
    </>
  );
}
