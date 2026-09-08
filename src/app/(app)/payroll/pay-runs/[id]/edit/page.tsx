import { notFound } from "next/navigation";
import { db } from "@/lib/db";
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

  const [payRun, employees, bankAccounts] = await Promise.all([
    db.payRun.findFirst({
      where: { id, companyId: company.id },
      include: { lines: { include: { employee: { select: { legalFirstName: true, legalLastName: true, preferredName: true } } } } },
    }),
    db.employee.findMany({
      where: { companyId: company.id, employmentStatus: "ACTIVE" },
      orderBy: { legalFirstName: "asc" },
      select: { id: true, legalFirstName: true, legalLastName: true, preferredName: true, compensationType: true, payRateCents: true, payFrequency: true },
    }),
    db.account.findMany({
      where: { companyId: company.id, isActive: true, subtype: { in: ["BANK", "CASH", "CREDIT_CARD"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);
  if (!payRun) notFound();

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
