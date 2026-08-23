import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { Badge, Card, CardHeader, DefinitionList, LinkButton, Money, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { PayRunActions } from "./pay-run-actions";

export const metadata = { title: "Pay run" };

const STATUS_TONE: Record<string, "neutral" | "positive" | "negative"> = {
  DRAFT: "neutral",
  POSTED: "positive",
  VOID: "negative",
};

export default async function PayRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { company, role } = await requireCapability(CAPABILITIES.PAYROLL);
  const { id } = await params;

  const payRun = await db.payRun.findFirst({
    where: { id, companyId: company.id },
    include: {
      lines: {
        include: { employee: { select: { id: true, legalFirstName: true, legalLastName: true, preferredName: true } } },
        orderBy: { employee: { legalFirstName: "asc" } },
      },
    },
  });
  if (!payRun) notFound();

  const bankAccount = await db.account.findUnique({ where: { id: payRun.bankAccountId }, select: { code: true, name: true } });

  const totals = payRun.lines.reduce(
    (sum, line) => ({
      gross: sum.gross + line.grossPayCents,
      cpp: sum.cpp + line.cppCents,
      ei: sum.ei + line.eiCents,
      federalTax: sum.federalTax + line.federalTaxCents,
      provincialTax: sum.provincialTax + line.provincialTaxCents,
      other: sum.other + line.otherDeductionsCents,
      employerCpp: sum.employerCpp + line.employerCppCents,
      employerEi: sum.employerEi + line.employerEiCents,
      net: sum.net + line.netPayCents,
    }),
    { gross: 0, cpp: 0, ei: 0, federalTax: 0, provincialTax: 0, other: 0, employerCpp: 0, employerEi: 0, net: 0 },
  );

  const canEdit = can(role, CAPABILITIES.PAYROLL);
  const currency = company.baseCurrency;

  return (
    <>
      <PageHeader
        title={`Pay run ${payRun.number}`}
        breadcrumb={[{ label: "Payroll", href: "/payroll/pay-runs" }, { label: "Pay runs", href: "/payroll/pay-runs" }, { label: payRun.number }]}
        description={`${formatDate(payRun.payPeriodStart)} – ${formatDate(payRun.payPeriodEnd)} · paid ${formatDate(payRun.payDate)}`}
        actions={
          canEdit ? (
            <>
              {payRun.status === "DRAFT" && <LinkButton href={`/payroll/pay-runs/${payRun.id}/edit`}>Edit</LinkButton>}
              <PayRunActions payRun={{ id: payRun.id, number: payRun.number, status: payRun.status }} />
            </>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={STATUS_TONE[payRun.status] ?? "neutral"}>{payRun.status}</Badge>
        <span className="text-[0.8125rem] text-muted-ink">{payRun.lines.length} employees</span>
        {payRun.journalEntryId && (
          <Link href={`/accounting/journals/${payRun.journalEntryId}`} className="text-[0.8125rem] text-brand-700 hover:underline">
            View journal entry →
          </Link>
        )}
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Total gross pay" cents={totals.gross} currency={currency} />
        <Stat label="Total withheld" cents={totals.cpp + totals.ei + totals.federalTax + totals.provincialTax + totals.other} currency={currency} />
        <Stat label="Total net pay" cents={totals.net} currency={currency} emphasis />
      </div>

      <Card className="mb-4 p-5">
        <CardHeader title="Details" />
        <div className="mt-3">
          <DefinitionList
            items={[
              { label: "Funded from", value: bankAccount ? `${bankAccount.code} — ${bankAccount.name}` : "—" },
              { label: "Memo", value: payRun.memo ?? "—" },
              { label: "Created", value: formatDate(payRun.createdAt) },
              ...(payRun.postedAt ? [{ label: "Posted", value: formatDate(payRun.postedAt) }] : []),
            ]}
          />
        </div>
      </Card>

      <Card className="p-5">
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th align="right">Gross</Th>
              <Th align="right">CPP</Th>
              <Th align="right">EI</Th>
              <Th align="right">Fed tax</Th>
              <Th align="right">Prov tax</Th>
              <Th align="right">Other</Th>
              <Th align="right">Empr CPP</Th>
              <Th align="right">Empr EI</Th>
              <Th align="right">Net pay</Th>
            </tr>
          </thead>
          <tbody>
            {payRun.lines.map((line) => (
              <Tr key={line.id}>
                <Td>
                  <Link href={`/hr/employees/${line.employee.id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                    {line.employee.preferredName || line.employee.legalFirstName} {line.employee.legalLastName}
                  </Link>
                </Td>
                <Td align="right"><Money cents={line.grossPayCents} currency={currency} /></Td>
                <Td align="right"><Money cents={line.cppCents} currency={currency} /></Td>
                <Td align="right"><Money cents={line.eiCents} currency={currency} /></Td>
                <Td align="right"><Money cents={line.federalTaxCents} currency={currency} /></Td>
                <Td align="right"><Money cents={line.provincialTaxCents} currency={currency} /></Td>
                <Td align="right"><Money cents={line.otherDeductionsCents} currency={currency} /></Td>
                <Td align="right" className="text-muted-ink"><Money cents={line.employerCppCents} currency={currency} /></Td>
                <Td align="right" className="text-muted-ink"><Money cents={line.employerEiCents} currency={currency} /></Td>
                <Td align="right" className="font-semibold text-ink-950"><Money cents={line.netPayCents} currency={currency} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

function Stat({ label, cents, currency, emphasis }: { label: string; cents: number; currency: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-[--radius-card] border bg-white p-4 ${emphasis ? "border-ink-900/15" : "border-paper-300"}`}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className="tnum mt-1 text-[1.375rem] font-semibold tracking-[-0.02em] text-ink-950">
        <Money cents={cents} currency={currency} />
      </p>
    </div>
  );
}
