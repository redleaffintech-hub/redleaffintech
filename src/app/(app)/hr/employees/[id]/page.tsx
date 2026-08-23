import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  Badge,
  Card,
  CardHeader,
  DefinitionList,
  LinkButton,
  Money,
  PageHeader,
} from "@/components/ui";
import {
  EMPLOYEE_TYPE_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  PAY_FREQUENCY_LABELS,
  PAY_FREQUENCY_PERIODS_PER_YEAR,
  TERMINATION_REASON_LABELS,
} from "@/lib/hr-enums";
import {
  MINIMUM_WAGE_AS_OF,
  MINIMUM_WAGE_CENTS,
  completedYears,
  minimumTerminationNoticeWeeks,
  statutoryHolidays,
  vacationEntitlement,
} from "@/server/hr/employment-standards";
import { leaveBalancesForEmployee } from "@/server/hr/leave";
import { EmployeeActions } from "./employee-actions";

const STATUS_TONE: Record<string, "positive" | "caution" | "neutral"> = {
  ACTIVE: "positive",
  ON_LEAVE: "caution",
  TERMINATED: "neutral",
};

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { company, role } = await requireCapability(CAPABILITIES.HR);
  const { id } = await params;

  const employee = await db.employee.findFirst({
    where: { id, companyId: company.id },
    include: {
      department: { select: { name: true } },
      manager: { select: { id: true, legalFirstName: true, legalLastName: true, jobTitle: true } },
      reports: { select: { id: true, legalFirstName: true, legalLastName: true, jobTitle: true, employmentStatus: true }, orderBy: { legalFirstName: "asc" } },
    },
  });
  if (!employee) notFound();

  const today = new Date();
  const years = completedYears(employee.hireDate, today);
  const vacation = vacationEntitlement(employee.provinceOfEmployment, years);
  const noticeWeeks = minimumTerminationNoticeWeeks(employee.provinceOfEmployment, years);
  const minWageCents = MINIMUM_WAGE_CENTS[employee.provinceOfEmployment];
  const upcomingHolidays = [
    ...statutoryHolidays(employee.provinceOfEmployment, today.getUTCFullYear()),
    ...statutoryHolidays(employee.provinceOfEmployment, today.getUTCFullYear() + 1),
  ].filter((h) => h.date >= today).slice(0, 5);

  const balances = await leaveBalancesForEmployee(company.id, employee.id);

  const periodsPerYear = PAY_FREQUENCY_PERIODS_PER_YEAR[employee.payFrequency as keyof typeof PAY_FREQUENCY_PERIODS_PER_YEAR];
  const perPeriodCents = employee.compensationType === "SALARY" ? Math.round(employee.payRateCents / periodsPerYear) : null;

  const fullName = `${employee.legalFirstName} ${employee.legalLastName}`;
  const canEdit = can(role, CAPABILITIES.HR);

  return (
    <>
      <PageHeader
        title={employee.preferredName ? `${employee.preferredName} ${employee.legalLastName}` : fullName}
        breadcrumb={[{ label: "HR", href: "/hr/employees" }, { label: "Employees", href: "/hr/employees" }, { label: fullName }]}
        description={`${employee.jobTitle}${employee.department ? ` · ${employee.department.name}` : ""} · Employee ${employee.employeeNumber}`}
        actions={
          canEdit ? (
            <>
              <LinkButton href={`/hr/employees/${employee.id}/edit`}>Edit</LinkButton>
              <EmployeeActions employee={{ id: employee.id, name: fullName, employmentStatus: employee.employmentStatus, hireDate: employee.hireDate.toISOString().slice(0, 10) }} />
            </>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Badge tone={STATUS_TONE[employee.employmentStatus] ?? "neutral"}>
          {EMPLOYMENT_STATUS_LABELS[employee.employmentStatus as keyof typeof EMPLOYMENT_STATUS_LABELS] ?? employee.employmentStatus}
        </Badge>
        {employee.employmentStatus === "TERMINATED" && employee.terminationDate && (
          <span className="text-[0.8125rem] text-muted-ink">
            Terminated {formatDate(employee.terminationDate)}
            {employee.terminationReason ? ` — ${TERMINATION_REASON_LABELS[employee.terminationReason as keyof typeof TERMINATION_REASON_LABELS] ?? employee.terminationReason}` : ""}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Employment" />
            <div className="mt-3">
              <DefinitionList
                items={[
                  { label: "Job title", value: employee.jobTitle },
                  { label: "Department", value: employee.department?.name ?? "—" },
                  { label: "Employee type", value: EMPLOYEE_TYPE_LABELS[employee.employeeType as keyof typeof EMPLOYEE_TYPE_LABELS] ?? employee.employeeType },
                  { label: "Province of employment", value: employee.provinceOfEmployment },
                  { label: "Hire date", value: formatDate(employee.hireDate) },
                  { label: "Years of service", value: String(years) },
                  {
                    label: "Reports to",
                    value: employee.manager ? (
                      <Link href={`/hr/employees/${employee.manager.id}`} className="text-brand-700 hover:underline">
                        {employee.manager.legalFirstName} {employee.manager.legalLastName}
                      </Link>
                    ) : (
                      "—"
                    ),
                  },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Compensation" />
            <div className="mt-3">
              <DefinitionList
                items={[
                  { label: "Type", value: employee.compensationType === "SALARY" ? "Salary" : "Hourly" },
                  {
                    label: employee.compensationType === "SALARY" ? "Annual salary" : "Hourly rate",
                    value: <Money cents={employee.payRateCents} currency={company.baseCurrency} />,
                  },
                  { label: "Pay frequency", value: PAY_FREQUENCY_LABELS[employee.payFrequency as keyof typeof PAY_FREQUENCY_LABELS] ?? employee.payFrequency },
                  ...(perPeriodCents !== null
                    ? [{ label: "Per pay period (gross, before deductions)", value: <Money cents={perPeriodCents} currency={company.baseCurrency} /> }]
                    : []),
                  { label: "Standard hours / week", value: employee.standardHoursPerWeek ? String(employee.standardHoursPerWeek) : "—" },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Personal" />
            <div className="mt-3">
              <DefinitionList
                items={[
                  { label: "Date of birth", value: employee.dateOfBirth ? formatDate(employee.dateOfBirth) : "—" },
                  { label: "Personal email", value: employee.personalEmail ?? "—" },
                  { label: "Personal phone", value: employee.personalPhone ?? "—" },
                  {
                    label: "Home address",
                    value: employee.addressLine1
                      ? `${employee.addressLine1}${employee.addressLine2 ? `, ${employee.addressLine2}` : ""}, ${employee.city ?? ""} ${employee.province ?? ""} ${employee.postalCode ?? ""}`
                      : "—",
                  },
                  { label: "SIN on file", value: employee.sinLast3 ? `••• ••• ${employee.sinLast3}` : "Not on file" },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Emergency contact" />
            <div className="mt-3">
              <DefinitionList
                items={[
                  { label: "Name", value: employee.emergencyContactName ?? "—" },
                  { label: "Phone", value: employee.emergencyContactPhone ?? "—" },
                  { label: "Relationship", value: employee.emergencyContactRelation ?? "—" },
                ]}
              />
            </div>
          </Card>

          {employee.reports.length > 0 && (
            <Card>
              <CardHeader title="Direct reports" subtitle={`${employee.reports.length} people report to ${employee.preferredName || employee.legalFirstName}`} />
              <ul className="mt-3 divide-y divide-paper-200">
                {employee.reports.map((report) => (
                  <li key={report.id} className="flex items-center justify-between gap-2 py-2 text-[0.8125rem]">
                    <Link href={`/hr/employees/${report.id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                      {report.legalFirstName} {report.legalLastName}
                    </Link>
                    <span className="text-muted-ink">{report.jobTitle}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {employee.notes && (
            <Card>
              <CardHeader title="Notes" />
              <p className="mt-2 whitespace-pre-wrap text-[0.8125rem] leading-6 text-ink-800">{employee.notes}</p>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="border-[color:var(--color-info)]/25 bg-info-soft/30">
            <CardHeader title="Employment-standards reference" subtitle={employee.provinceOfEmployment} />
            <p className="mt-2 text-[0.6875rem] leading-5 text-muted-ink">
              Reference figures only, not legal advice — confirm current requirements for {employee.provinceOfEmployment} before relying on them.
            </p>
            <div className="mt-3">
              <DefinitionList
                items={[
                  {
                    label: "Minimum vacation entitlement",
                    value: vacation ? `${vacation.weeks} weeks (${(vacation.percentMicro / 10_000).toString()}%)` : "Not available",
                  },
                  { label: "Minimum termination notice", value: `${noticeWeeks} week${noticeWeeks === 1 ? "" : "s"}` },
                  {
                    label: `Minimum wage (as of ${MINIMUM_WAGE_AS_OF})`,
                    value: minWageCents ? formatMoney(minWageCents, { currency: "CAD", showCurrency: true }) + "/hr" : "—",
                  },
                ]}
              />
            </div>
            {upcomingHolidays.length > 0 && (
              <div className="mt-4 border-t border-[color:var(--color-info)]/20 pt-3">
                <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Upcoming statutory holidays</p>
                <ul className="space-y-1">
                  {upcomingHolidays.map((h) => (
                    <li key={h.name + h.date.toISOString()} className="flex items-center justify-between text-[0.8125rem]">
                      <span className="text-ink-800">{h.name}</span>
                      <span className="tnum text-muted-ink">{formatDate(h.date)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Leave balances" action={<Link href="/hr/time-off" className="text-[0.75rem] text-brand-700 hover:underline">Time off →</Link>} />
            {balances.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-muted-ink">No leave types with a tracked balance.</p>
            ) : (
              <ul className="mt-3 divide-y divide-paper-200">
                {balances.map((b) => (
                  <li key={b.leaveTypeId} className="flex items-center justify-between py-2 text-[0.8125rem]">
                    <span className="text-ink-800">{b.leaveTypeName}</span>
                    <span className="tnum font-medium text-ink-900">{b.balanceHours.toFixed(1)}h</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

