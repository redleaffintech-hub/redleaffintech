import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { blankEmployee } from "../employee-form-values";

export const metadata = { title: "New employee" };

export default async function NewEmployeePage() {
  const { company } = await requireCapability(CAPABILITIES.HR);

  const [departments, managers] = await Promise.all([
    db.department.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employee.findMany({
      where: { companyId: company.id, employmentStatus: { not: "TERMINATED" } },
      orderBy: { legalFirstName: "asc" },
      select: { id: true, legalFirstName: true, legalLastName: true },
    }),
  ]);

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
