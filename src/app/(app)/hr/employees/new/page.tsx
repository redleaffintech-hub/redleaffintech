import { employees as employeesRepo, departments as departmentsRepo } from "@/server/db/hr";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { blankEmployee } from "../employee-form-values";

export const metadata = { title: "New employee" };

export default async function NewEmployeePage() {
  const { company } = await requireCapability(CAPABILITIES.HR);

  const [allDepartments, allEmployees] = await Promise.all([
    departmentsRepo.list(company.id),
    employeesRepo.list(company.id),
  ]);
  const departments = [...allDepartments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ id: d.id, name: d.name }));
  const managers = allEmployees
    .filter((e) => e.employmentStatus !== "TERMINATED")
    .sort((a, b) => a.legalFirstName.localeCompare(b.legalFirstName))
    .map((m) => ({ id: m.id, legalFirstName: m.legalFirstName, legalLastName: m.legalLastName }));

  return (
    <>
      <PageHeader
        title="New employee"
        breadcrumb={[{ label: "HR", href: "/hr/employees" }, { label: "Employees", href: "/hr/employees" }, { label: "New" }]}
        description="The province of employment drives the compliance reference shown on the employee's profile — minimum vacation entitlement, statutory holidays and minimum termination notice."
      />
      <Card className="max-w-5xl p-5">
        <EmployeeForm
          initial={blankEmployee(company.province)}
          departments={departments}
          managers={managers.map((m) => ({ id: m.id, name: `${m.legalFirstName} ${m.legalLastName}` }))}
        />
      </Card>
    </>
  );
}
