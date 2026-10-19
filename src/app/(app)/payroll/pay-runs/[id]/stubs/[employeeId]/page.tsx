import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { loadPayStub } from "@/server/payroll/pay-stub-data";
import { formatDate, formatDateLong } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { PROVINCES } from "@/lib/enums";
import { Card, PageHeader } from "@/components/ui";
import { PayStubActions } from "./pay-stub-actions";

export const metadata = { title: "Pay stub" };

export default async function PayStubPage({ params }: { params: Promise<{ id: string; employeeId: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.PAYROLL);
  const { id, employeeId } = await params;

  // Stubs only exist for a finalized pay run; the same data feeds the PDF.
  const stub = await loadPayStub(company.id, id, employeeId);
  if (!stub) notFound();
  const { line, employee, payRun, profile: companyProfile, ytd, earnings, deductions, totalDeductions } = stub;

  const currency = company.baseCurrency;
  const fmt = (cents: number) => formatMoney(cents, { currency });
  const provinceName = PROVINCES.find((p) => p.code === employee.provinceOfEmployment)?.name ?? employee.provinceOfEmployment;

  return (
    <>
      <PageHeader
        title={`Pay stub — ${employee.preferredName || employee.legalFirstName} ${employee.legalLastName}`}
        breadcrumb={[
          { label: "Payroll", href: "/payroll/pay-runs" },
          { label: "Pay runs", href: "/payroll/pay-runs" },
          { label: payRun.number, href: `/payroll/pay-runs/${payRun.id}` },
          { label: "Pay stub" },
        ]}
        actions={<PayStubActions pdfHref={`/payroll/pay-runs/${payRun.id}/stubs/${employee.id}/pdf`} />}
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
                <tr><td className="py-0.5 pr-3 text-left text-[color:var(--inv-ink)]/70">Pay run</td><td className="tnum py-0.5 text-right font-medium">{payRun.number}</td></tr>
                <tr><td className="py-0.5 pr-3 text-left text-[color:var(--inv-ink)]/70">Period</td><td className="tnum py-0.5 text-right font-medium">{formatDate(payRun.payPeriodStart)} – {formatDate(payRun.payPeriodEnd)}</td></tr>
                <tr><td className="py-0.5 pr-3 text-left text-[color:var(--inv-ink)]/70">Pay date</td><td className="tnum py-0.5 text-right font-medium">{formatDateLong(payRun.payDate)}</td></tr>
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
              {payRun.bankAccountId && <p>Direct deposit on file</p>}
            </div>
          </div>
        </div>

        <div className="inv-scroll mt-5">
          <table className="inv-table min-w-[40rem]">
            <thead>
              <tr>
                <th>Earnings</th>
                <th className="inv-num w-16">Hours</th>
                <th className="inv-num w-20">Rate</th>
                <th className="inv-num w-28">Current</th>
                <th className="inv-num w-28">Year to date</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((row, index) => (
                <tr key={row.label}>
                  <td className={index === 0 ? "font-medium" : undefined}>{row.label}</td>
                  <td className="inv-num tnum">{row.hours ?? ""}</td>
                  <td className="inv-num tnum">{row.rateCents ? fmt(row.rateCents) : ""}</td>
                  <td className="inv-num tnum">{fmt(row.currentCents)}</td>
                  <td className="inv-num tnum">{fmt(row.ytdCents)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Gross pay</td>
                <td className="inv-num" />
                <td className="inv-num" />
                <td className="inv-num tnum font-semibold">{fmt(line.grossPayCents)}</td>
                <td className="inv-num tnum font-semibold">{fmt(ytd.grossCents)}</td>
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
              {deductions.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="inv-num tnum">{fmt(row.currentCents)}</td>
                  <td className="inv-num tnum">{fmt(row.ytdCents)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Total deductions</td>
                <td className="inv-num tnum font-semibold">{fmt(totalDeductions.currentCents)}</td>
                <td className="inv-num tnum font-semibold">{fmt(totalDeductions.ytdCents)}</td>
              </tr>
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
        <Link href={`/payroll/pay-runs/${payRun.id}`} className="text-brand-700 hover:underline">← Back to pay run {payRun.number}</Link>
      </p>
    </>
  );
}
