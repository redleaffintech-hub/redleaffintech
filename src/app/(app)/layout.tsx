import { requireCompany } from "@/server/auth/context";
import { checkLedgerIntegrity } from "@/server/accounting/ledger";
import { listBankTransactions } from "@/server/db/banking";
import { invoices as invoicesRepo } from "@/server/db/invoices";
import { bills as billsRepo } from "@/server/db/bills";
import { notifications as notificationsRepo } from "@/server/db/supporting";
import { listFiscalPeriods } from "@/server/db/fiscal-periods";
import { accessLevel, CAPABILITIES, type AccessLevel } from "@/lib/permissions";
import { MainNav } from "@/components/shell/main-nav";
import { Topbar } from "@/components/shell/topbar";
import { CurrencyProvider } from "@/components/currency-context";
import { today, formatMonthLong } from "@/lib/dates";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, company, role, memberships } = await requireCompany();

  const [bankTxns, allInvoices, allBills, allNotifications, integrity, periods] = await Promise.all([
    listBankTransactions(company.id, { status: "UNMATCHED" }),
    invoicesRepo.list(company.id),
    billsRepo.list(company.id),
    notificationsRepo.list(company.id),
    checkLedgerIntegrity(company.id),
    listFiscalPeriods(company.id),
  ]);
  const bankQueue = bankTxns.length;
  const overdue = allInvoices.filter((i) => i.status === "OVERDUE").length;
  const approvals = allBills.filter((b) => b.approvalStatus === "PENDING").length;
  const notifications = allNotifications
    .filter((n) => !n.isRead)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8)
    .map((n) => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, link: n.link }));
  const now = today();
  const currentPeriod =
    periods.find((p) => p.startDate <= now && p.endDate >= now) ?? null;

  // Resolve the whole capability map once so the sidebar can hide what this
  // role cannot see. The server still enforces it on every page.
  const access = Object.fromEntries(
    Object.values(CAPABILITIES).map((capability) => [capability, accessLevel(role, capability)]),
  ) as Record<string, AccessLevel>;

  return (
    <CurrencyProvider currency={company.baseCurrency}>
      <div className="flex min-h-dvh flex-col">
        {/* Identity bar and module nav stick together: the nav is how you move
            between products, so it has to stay reachable while a long ledger
            scrolls. Its height is published as --app-header-h for the rails that
            sit beneath it. */}
        <div className="no-print sticky top-0 z-30 border-b border-paper-300 bg-white/90 backdrop-blur-md">
          <Topbar
            user={{ name: user.name, email: user.email }}
            companyName={company.name}
            companyLogoUrl={company.logoUrl}
            province={company.province}
            role={role}
            memberships={memberships}
            notifications={notifications}
            periodLabel={
              currentPeriod
                ? `${currentPeriod.name}${currentPeriod.status !== "OPEN" ? ` · ${currentPeriod.status.toLowerCase()}` : ""}`
                : formatMonthLong(today())
            }
            ledgerHealthy={integrity.balanced && integrity.equationGapCents === 0}
          />
          <MainNav
            access={access}
            counts={{ bankQueue, overdue, approvals }}
            isAccountant={role === "ACCOUNTANT"}
            enabledModules={company.enabledModules}
          />
        </div>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </CurrencyProvider>
  );
}
