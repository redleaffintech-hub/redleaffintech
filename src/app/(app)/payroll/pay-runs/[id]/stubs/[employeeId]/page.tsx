import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { getCompanyProfile } from "@/server/companies/profile";
import { payrollYtd } from "@/server/payroll/ytd";
import { formatDate, formatDateLong } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PROVINCES } from "@/lib/enums";
import { Card, PageHeader } from "@/components/ui";
import { PayStubActions } from "./pay-stub-actions";

export const metadata = { title: "Pay stub" };

export default async function PayStubPage({ params }: { params: Promise<{ id: string; employeeId: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);
  const { id, employeeId } = await params;

  const line = await db.payRunLine.findFirst({
    where: { payRunId: id, employeeId, companyId: company.id },
    include: { payRun: true, employee: true },
  });
  if (!line) notFound();
  if (line.payRun.status !== "POSTED") notFound(); // stubs only exist for a finalized pay run

  const [companyProfile, ytd] = await Promise.all([
    getCompanyProfile(company.id),
    payrollYtd(company.id, employeeId, line.payRun.payDate.getUTCFullYear(), line.payRun.payDate),
  ]);

  const currency = company.baseCurrency;
  const fmt = (cents: number) => formatMoney(cents, { currency });
  const { employee } = line;
  const provinceName = PROVINCES.find((p) => p.code === employee.provinceOfEmployment)?.name ?? employee.provinceOfEmployment;

  // Year-to-date is only tracked in aggregate (see payrollYtd's comment on why
  // this app doesn't store a running total per earnings type) — every
  // individual earnings line below shows this period's amount only; the
  // combined Gross pay row at the bottom is what carries the real YTD figure.
  const earningsRows: { label: string; hours: number | null; current: number }[] = [
    { label: "Regular", hours: line.regularHours, current: line.regularPayCents },
    ...[
      { label: "Overtime", hours: line.overtimeHours, current: line.overtimePayCents },
      { label: "Vacation pay", hours: null, current: line.vacationPayCents },
      { label: "Sick pay", hours: null, current: line.sickPayCents },
      { label: "Bonus", hours: null, current: line.bonusCents },
      { label: "Retroactive pay", hours: null, current: line.retroactivePayCents },
      { label: "Statutory holiday pay", hours: null, current: line.statutoryHolidayPayCents },
    ].filter((row) => row.current !== 0),
  ];

  const deductionRows: { label: string; current: number; ytd: number | null }[] = [
    { label: "CPP", current: line.cppCents, ytd: ytd.cppCents },
    { label: "CPP2", current: line.cpp2Cents, ytd: ytd.cpp2Cents },
    { label: "EI", current: line.eiCents, ytd: ytd.eiCents },
    // QPIP only applies to Quebec employees — omitted entirely rather than
    // shown as a permanent $0.00 row for everyone else.
    ...(line.qpipCents !== 0 || ytd.qpipCents !== 0 ? [{ label: "QPIP", current: line.qpipCents, ytd: ytd.qpipCents }] : []),
    { label: "Federal tax", current: line.federalTaxCents, ytd: ytd.federalTaxCents },
    { label: "Provincial tax", current: line.provincialTaxCents, ytd: ytd.provincialTaxCents },
    // Not separately accumulated year-to-date (payrollYtd only totals the
    // statutory deductions), so this period's amount only.
    ...(line.otherDeductionsCents !== 0
      ? [{ label: line.otherDeductionsNote || "Other deductions", current: line.otherDeductionsCents, ytd: null }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={`Pay stub — ${employee.preferredName || employee.legalFirstName} ${employee.legalLastName}`}
        breadcrumb={[
          { label: "Payroll", href: "/payroll/pay-runs" },
          { label: "Pay runs", href: "/payroll/pay-runs" },
          { label: line.payRun.number, href: `/payroll/pay-runs/${line.payRun.id}` },
          { label: "Pay stub" },
        ]}
        actions={<PayStubActions />}
      />

      <Card className="invoice-paper print-full">
        <div className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-[color:var(--inv-accent)] pb-4">
          <div className="flex items-start gap-3">
            {companyProfile.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL, not an optimizable remote asset
              <img src={companyProfile.logoUrl} alt="" className="h-14 w-14 rounded object-contain" />
            )}
            <div>
              <p className="text-[1.0625rem] font-semibold tracking-[-0.01em]">
                {companyProfile.legalName ?? companyProfile.name}
              </p>
              <p className="mt-1 text-[0.8125rem] leading-6 text-[color:var(--inv-ink)]/75">
                {companyProfile.addressLine1}
                {companyProfile.addressLine1 && <br />}
                {[companyProfile.city, companyProfile.province, companyProfile.postalCode].filter(Boolean).join(", ")}
              </p>
            </div>
          </div>
          <div className="min-w-[15rem] text-right">
            <p className="inv-accent text-[1.75rem] font-bold uppercase tracking-[0.02em]">Pay stub</p>
            <table className="mt-2 ml-auto text-[0.8125rem]">
              <tbody>
                <tr><td className="py-0.5 pr-3 text-left text-[color:var(--inv-ink)]/70">Pay run</td><td className="tnum py-0.5 text-right font-medium">{line.payRun.number}</td></tr>
                <tr><td className="py-0.5 pr-3 text-left text-[color:var(--inv-ink)]/70">Period</td><td className="tnum py-0.5 text-right font-medium">{formatDate(line.payRun.payPeriodStart)} – {formatDate(line.payRun.payPeriodEnd)}</td></tr>
                <tr><td className="py-0.5 pr-3 text-left text-[color:var(--inv-ink)]/70">Pay date</td><td className="tnum py-0.5 text-right font-medium">{formatDateLong(line.payRun.payDate)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="inv-keep">
            <div className="inv-band">Employee</div>
            <div className="inv-box text-[0.8125rem] leading-6">
              <p className="font-medium">{employee.legalFirstName} {employee.legalLastName}</p>
              <p>{employee.jobTitle}</p>
              {employee.addressLine1 && <p>{employee.addressLine1}</p>}
              {(employee.city || employee.postalCode) && (
                <p>{[employee.city, provinceName, employee.postalCode].filter(Boolean).join(", ")}</p>
              )}
            </div>
          </div>
          <div className="inv-keep">
            <div className="inv-band">Details</div>
            <div className="inv-box text-[0.8125rem] leading-6">
              <p>Employee #: {employee.employeeNumber}</p>
              <p>Employment type: {employee.employeeType}</p>
              {employee.sinLast3 && <p>SIN: •••&nbsp;•••&nbsp;{employee.sinLast3}</p>}
              {line.payRun.bankAccountId && <p>Direct deposit on file</p>}
            </div>
          </div>
        </div>

        <div className="inv-scroll mt-5">
          <table className="inv-table min-w-[36rem]">
            <thead>
              <tr>
                <th>Earnings</th>
                <th className="inv-num w-16">Hours</th>
                <th className="inv-num w-28">Current</th>
              </tr>
            </thead>
            <tbody>
              {earningsRows.map((row, index) => (
                <tr key={row.label}>
                  <td className={index === 0 ? "font-medium" : undefined}>{row.label}</td>
                  <td className="inv-num tnum">{row.hours ?? ""}</td>
                  <td className="inv-num tnum">{fmt(row.current)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Gross pay</td>
                <td className="inv-num" />
                <td className="inv-num tnum font-semibold">{fmt(line.grossPayCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="inv-scroll mt-4">
          <table className="inv-table min-w-[36rem]">
            <thead>
              <tr>
                <th>Deductions</th>
                <th className="inv-num w-28">Current</th>
                <th className="inv-num w-28">Year to date</th>
              </tr>
            </thead>
            <tbody>
              {deductionRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="inv-num tnum">{fmt(row.current)}</td>
                  <td className="inv-num tnum">{row.ytd === null ? "—" : fmt(row.ytd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="inv-keep">
            {(line.employerCppCents > 0 || line.employerCpp2Cents > 0 || line.employerEiCents > 0 || line.employerQpipCents > 0) && (
              <>
                <div className="inv-band">Employer contributions (informational)</div>
                <div className="inv-box text-[0.8125rem] leading-6">
                  <p>Employer CPP: {fmt(line.employerCppCents)}</p>
                  <p>Employer CPP2: {fmt(line.employerCpp2Cents)}</p>
                  <p>Employer EI: {fmt(line.employerEiCents)}</p>
                  {line.employerQpipCents > 0 && <p>Employer QPIP: {fmt(line.employerQpipCents)}</p>}
                </div>
              </>
            )}
          </div>
          <div className="inv-keep">
            <table className="inv-totals ml-auto max-w-xs text-[0.8125rem]">
              <tbody>
                <tr className="inv-grand">
                  <td>Net pay</td>
                  <td className="tnum">{fmt(line.netPayCents)}</td>
                </tr>
                <tr>
                  <td className="text-[color:var(--inv-ink)]/75">Year to date gross</td>
                  <td className="tnum">{fmt(ytd.grossCents)}</td>
                </tr>
                <tr>
                  <td className="text-[color:var(--inv-ink)]/75">Year to date net</td>
                  <td className="tnum">{fmt(ytd.netCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {line.notes && (
          <div className="inv-footer">
            <p className="whitespace-pre-line">{line.notes}</p>
          </div>
        )}
      </Card>

      <p className="no-print mt-3 text-[0.75rem] text-muted-ink">
        <Link href={`/payroll/pay-runs/${line.payRun.id}`} className="text-brand-700 hover:underline">← Back to pay run {line.payRun.number}</Link>
      </p>
    </>
  );
}
