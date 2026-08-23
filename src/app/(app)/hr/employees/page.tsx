import Link from "next/link";
import { db } from "@/lib/db";
import { contains } from "@/lib/search";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { EMPLOYEE_TYPE_LABELS, EMPLOYMENT_STATUS_LABELS } from "@/lib/hr-enums";
import { Badge, Card, LinkButton, LinkCell, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { Icon } from "@/components/shell/icons";

export const metadata = { title: "Employees" };

const STATUS_TONE: Record<string, "positive" | "caution" | "neutral"> = {
  ACTIVE: "positive",
  ON_LEAVE: "caution",
  TERMINATED: "neutral",
};

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, role } = await requireCapability(CAPABILITIES.HR);
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const status = typeof params.status === "string" ? params.status : "";

  const employees = await db.employee.findMany({
    where: {
      companyId: company.id,
      ...(status ? { employmentStatus: status } : {}),
      ...(query
        ? {
            OR: [
              { legalFirstName: contains(query) },
              { legalLastName: contains(query) },
              { preferredName: contains(query) },
              { employeeNumber: contains(query) },
              { jobTitle: contains(query) },
            ],
          }
        : {}),
    },
    include: { department: { select: { name: true } } },
    orderBy: [{ employmentStatus: "asc" }, { legalFirstName: "asc" }],
  });

  const counts = {
    all: employees.length,
    active: employees.filter((e) => e.employmentStatus === "ACTIVE").length,
    onLeave: employees.filter((e) => e.employmentStatus === "ON_LEAVE").length,
    terminated: employees.filter((e) => e.employmentStatus === "TERMINATED").length,
  };

  return (
    <>
      <PageHeader
        title="Employees"
        breadcrumb={[{ label: "HR" }, { label: "Employees" }]}
        description="Employee records for this company — personal and employment details, org chart and time off. There is no payroll engine yet: nothing here calculates deductions or posts to the ledger."
        actions={
          can(role, CAPABILITIES.HR) ? (
            <LinkButton href="/hr/employees/new" variant="primary">
              <Icon name="plus" className="h-3.5 w-3.5" />
              New employee
            </LinkButton>
          ) : undefined
        }
      />

      <FilterBar
        searchPlaceholder="Search name, number or title…"
        tabs={[
          { label: "All", value: "" },
          { label: "Active", value: "ACTIVE", count: counts.active },
          { label: "On leave", value: "ON_LEAVE", count: counts.onLeave },
          { label: "Terminated", value: "TERMINATED", count: counts.terminated },
        ]}
      />

      <Card className="p-5">
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Number</Th>
              <Th>Job title</Th>
              <Th>Department</Th>
              <Th>Type</Th>
              <Th>Hire date</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="py-10 text-center text-muted-ink">
                  {query || status ? "No employees match this filter." : "No employees yet. Add the first one to get started."}
                </Td>
              </Tr>
            ) : (
              employees.map((employee) => (
                <Tr key={employee.id}>
                  <Td>
                    <LinkCell href={`/hr/employees/${employee.id}`}>
                      {employee.preferredName || employee.legalFirstName} {employee.legalLastName}
                    </LinkCell>
                  </Td>
                  <Td className="tnum text-muted-ink">{employee.employeeNumber}</Td>
                  <Td>{employee.jobTitle}</Td>
                  <Td className="text-muted-ink">{employee.department?.name ?? "—"}</Td>
                  <Td className="text-muted-ink">{EMPLOYEE_TYPE_LABELS[employee.employeeType as keyof typeof EMPLOYEE_TYPE_LABELS] ?? employee.employeeType}</Td>
                  <Td className="text-muted-ink">{formatDate(employee.hireDate)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[employee.employmentStatus] ?? "neutral"}>
                      {EMPLOYMENT_STATUS_LABELS[employee.employmentStatus as keyof typeof EMPLOYMENT_STATUS_LABELS] ?? employee.employmentStatus}
                    </Badge>
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      <p className="mt-3 text-center">
        <Link href="/hr/departments" className="text-[0.8125rem] text-muted-ink hover:text-ink-800 hover:underline">
          Manage departments
        </Link>
        <span className="mx-2 text-paper-400">·</span>
        <Link href="/hr/time-off" className="text-[0.8125rem] text-muted-ink hover:text-ink-800 hover:underline">
          Time off
        </Link>
      </p>
    </>
  );
}
