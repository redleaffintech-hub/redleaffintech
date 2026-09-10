import { notFound } from "next/navigation";
import { payRuns as payRunsRepo } from "@/server/db/payroll";
import { employees as employeesRepo } from "@/server/db/hr";
import { listAccounts } from "@/server/db/accounts";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { isoDate } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui";
import { PayRunForm } from "../../pay-run-form";
import { buildEditLines, type PayRunFormValues } from "../../pay-run-values";

export const metadata = { title: "Edit pay run" };

export default async function EditPayRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);
  const { id } = await params;

  const [rawPayRun, allEmployees, allAccounts] = await Promise.all([
    payRunsRepo.get(company.id, id),
    employeesRepo.list(company.id),
    listAccounts(company.id),
  ]);
  if (!rawPayRun) notFound();
  const employeeById = new Map(allEmployees.map((e) => [e.id, e]));
  const payRun = {
    ...rawPayRun,
    lines: rawPayRun.lines.map((l) => {
      const e = employeeById.get(l.employeeId);
      return {
        ...l,
        employee: {
          legalFirstName: e?.legalFirstName ?? "",
          legalLastName: e?.legalLastName ?? "",
          preferredName: e?.preferredName ?? null,
        },
      };
    }),
  };
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

  if (payRun.status !== "DRAFT") {
    return (
      <>
        <PageHeader
          title={`Edit pay run ${payRun.number}`}
          breadcrumb={[{ label: "Payroll", href: "/payroll/pay-runs" }, { label: "Pay runs", href: "/payroll/pay-runs" }, { label: payRun.number, href: `/payroll/pay-runs/${payRun.id}` }, { label: "Edit" }]}
        />
        <Card className="p-5">
          <p className="text-[0.8125rem] leading-6 text-ink-700">
            Pay run {payRun.number} is {payRun.status.toLowerCase()} and can no longer be edited.
            {payRun.status === "POSTED" && " Void it to reverse the posting, then create a new pay run to correct it."}
          </p>
        </Card>
      </>
    );
  }

  const initial: PayRunFormValues = {
    id: payRun.id,
    payPeriodStart: isoDate(payRun.payPeriodStart),
    payPeriodEnd: isoDate(payRun.payPeriodEnd),
    payDate: isoDate(payRun.payDate),
    bankAccountId: payRun.bankAccountId,
    memo: payRun.memo ?? "",
    lines: buildEditLines(payRun.lines, employees),
  };

  return (
    <>
      <PageHeader
        title={`Edit pay run ${payRun.number}`}
        breadcrumb={[{ label: "Payroll", href: "/payroll/pay-runs" }, { label: "Pay runs", href: "/payroll/pay-runs" }, { label: payRun.number, href: `/payroll/pay-runs/${payRun.id}` }, { label: "Edit" }]}
      />
      <Card className="p-5">
        <PayRunForm initial={initial} bankAccounts={bankAccounts} />
      </Card>
    </>
  );
}
