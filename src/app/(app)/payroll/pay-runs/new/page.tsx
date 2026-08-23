import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { PayRunForm } from "../pay-run-form";
import { blankPayRun } from "../pay-run-values";

export const metadata = { title: "New pay run" };

export default async function NewPayRunPage() {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);

  const [employees, bankAccounts] = await Promise.all([
    db.employee.findMany({
      where: { companyId: company.id, employmentStatus: "ACTIVE" },
      orderBy: { legalFirstName: "asc" },
      select: { id: true, legalFirstName: true, legalLastName: true, preferredName: true, compensationType: true, payRateCents: true, payFrequency: true },
    }),
    db.account.findMany({
      where: { companyId: company.id, isActive: true, subtype: { in: ["BANK", "CREDIT_CARD"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="New pay run"
        breadcrumb={[{ label: "Payroll", href: "/payroll/pay-runs" }, { label: "Pay runs", href: "/payroll/pay-runs" }, { label: "New" }]}
        description="CPP, EI and income tax are entered per employee, not calculated by this app — get the figures from CRA's PDOC tool, a payroll service, or your accountant. Saves as a draft first; nothing posts to the ledger until you post it."
      />
      <Card className="p-5">
        <PayRunForm
          initial={blankPayRun(bankAccounts[0]?.id ?? "", employees)}
          bankAccounts={bankAccounts}
        />
      </Card>
    </>
  );
}
