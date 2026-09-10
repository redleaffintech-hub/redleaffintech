import { employees as employeesRepo } from "@/server/db/hr";
import { listAccounts } from "@/server/db/accounts";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { PayRunForm } from "../pay-run-form";
import { blankPayRun } from "../pay-run-values";

export const metadata = { title: "New pay run" };

export default async function NewPayRunPage() {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);

  const [allEmployees, allAccounts] = await Promise.all([
    employeesRepo.list(company.id),
    listAccounts(company.id),
  ]);
  const employees = allEmployees
    .filter((e) => e.employmentStatus === "ACTIVE")
    .sort((a, b) => a.legalFirstName.localeCompare(b.legalFirstName))
    .map((e) => ({
      id: e.id,
      legalFirstName: e.legalFirstName,
      legalLastName: e.legalLastName,
      preferredName: e.preferredName,
      compensationType: e.compensationType,
      payRateCents: e.payRateCents,
      payFrequency: e.payFrequency,
    }));
  const bankAccounts = allAccounts
    .filter((a) => a.isActive && ["BANK", "CASH", "CREDIT_CARD"].includes(a.subtype))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ id: a.id, code: a.code, name: a.name }));

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
