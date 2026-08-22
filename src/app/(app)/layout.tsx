import { db } from "@/lib/db";
import { requireCompany } from "@/server/auth/context";
import { checkLedgerIntegrity } from "@/server/accounting/ledger";
import { accessLevel, CAPABILITIES, type AccessLevel } from "@/lib/permissions";
import { MainNav } from "@/components/shell/main-nav";
import { Topbar } from "@/components/shell/topbar";
import { today, formatMonthLong } from "@/lib/dates";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, company, role, memberships } = await requireCompany();

  const [bankQueue, overdue, approvals, notifications, integrity, currentPeriod] = await Promise.all([
    db.bankTransaction.count({ where: { companyId: company.id, status: "UNMATCHED" } }),
    db.invoice.count({ where: { companyId: company.id, status: "OVERDUE" } }),
    db.bill.count({ where: { companyId: company.id, approvalStatus: "PENDING" } }),
    db.notification.findMany({
      where: { companyId: company.id, isRead: false },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, title: true, body: true, severity: true, link: true },
    }),
    checkLedgerIntegrity(db, company.id),
    db.fiscalPeriod.findFirst({
      where: { companyId: company.id, startDate: { lte: today() }, endDate: { gte: today() } },
      select: { name: true, status: true },
    }),
  ]);

  // Resolve the whole capability map once so the sidebar can hide what this
  // role cannot see. The server still enforces it on every page.
  const access = Object.fromEntries(
    Object.values(CAPABILITIES).map((capability) => [capability, accessLevel(role, capability)]),
  ) as Record<string, AccessLevel>;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Identity bar and module nav stick together: the nav is how you move
          between products, so it has to stay reachable while a long ledger
          scrolls. Its height is published as --app-header-h for the rails that
          sit beneath it. */}
      <div className="no-print sticky top-0 z-30 border-b border-paper-300 bg-white/90 backdrop-blur-md">
        <Topbar
          user={{ name: user.name, email: user.email }}
          companyName={company.name}
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
        />
      </div>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
