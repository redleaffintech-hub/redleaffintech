import Link from "next/link";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { PageHeader, Card } from "@/components/ui";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Reports" };

/** The §12 report inventory. */
const REPORT_GROUPS = [
  {
    label: "Financial statements",
    reports: [
      { name: "Trial balance", href: "/accounting/trial-balance", description: "Opening, period movement and closing balance for every account." },
      { name: "Profit & loss", href: "/reports/profit-and-loss", description: "Revenue, cost of sales and expenses with prior-period comparison and drill-down." },
      { name: "Balance sheet", href: "/reports/balance-sheet", description: "Assets, liabilities and equity as at any date, with the balancing check shown." },
      { name: "Cash flow", href: "/reports/cash-flow", description: "Operating, investing and financing movements, reconciled to the change in cash." },
    ],
  },
  {
    label: "Receivables & payables",
    reports: [
      { name: "A/R aging", href: "/reports/ar-aging", description: "Customer balances by aging bucket, reconciled to the A/R control account." },
      { name: "A/P aging", href: "/reports/ap-aging", description: "Vendor balances by aging bucket, reconciled to the A/P control account." },
      { name: "Customer statement", href: "/sales/customers", description: "Opening balance, activity, payments and closing balance per customer." },
      { name: "Vendor statement", href: "/purchases/vendors", description: "Opening balance, activity, payments and closing balance per vendor." },
    ],
  },
  {
    label: "Tax",
    reports: [
      { name: "Tax summary", href: "/reports/tax-summary", description: "Tax collected and input tax credits by code, jurisdiction and period." },
      { name: "Tax detail", href: "/reports/tax-detail", description: "Every taxable transaction with the rate that was in force when it posted." },
      { name: "GST/HST return", href: "/tax", description: "Working figures for the filing: supplies, tax collected, ITCs and net remittance." },
    ],
  },
  {
    label: "Ledger & audit",
    reports: [
      { name: "General ledger", href: "/accounting/general-ledger", description: "Every posting per account with a running balance." },
      { name: "Journal report", href: "/accounting/journals", description: "Posted and reversed entries by source, user and period." },
      { name: "Budget vs actual", href: "/reports/budget-vs-actual", description: "Account-level variance against the operating budget." },
      { name: "Audit log", href: "/company/audit", description: "Who did what, when — every post, void, close and reopen." },
    ],
  },
] as const;

export default async function ReportsPage() {
  const { company } = await requireCapability(CAPABILITIES.REPORTS);

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Every figure below is aggregated from ${company.name}'s posted journal entries, and every total drills back to the transactions behind it.`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {REPORT_GROUPS.map((group) => (
          <Card key={group.label} padded={false} className="p-5">
            <h2 className="mb-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-ink">
              {group.label}
            </h2>
            <ul className="divide-y divide-paper-200">
              {group.reports.map((report) => (
                <li key={report.name}>
                  <Link href={report.href} className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-paper-100">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-paper-200 text-ink-600 transition-colors group-hover:bg-brand-soft group-hover:text-brand-700">
                      <Icon name="chart" className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.875rem] font-medium text-ink-900">{report.name}</span>
                      <span className="block text-[0.75rem] leading-5 text-muted-ink">{report.description}</span>
                    </span>
                    <Icon name="chevron" className="mt-1.5 h-3.5 w-3.5 shrink-0 text-ink-300" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
