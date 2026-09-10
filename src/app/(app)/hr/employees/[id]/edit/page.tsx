import { notFound } from "next/navigation";
import { employees as employeesRepo, departments as departmentsRepo } from "@/server/db/hr";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { isoDate } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui";
import { maskSin } from "@/server/hr/employment-standards";
import { EmployeeForm } from "../../employee-form";
import type { EmployeeFormValues } from "../../employee-form-values";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.HR);
  const { id } = await params;

  const [employee, allDepartments, allEmployees] = await Promise.all([
    employeesRepo.get(company.id, id),
    departmentsRepo.list(company.id),
    employeesRepo.list(company.id),
  ]);
  if (!employee) notFound();
  const departments = [...allDepartments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ id: d.id, name: d.name }));
  const managers = allEmployees
    .filter((e) => e.employmentStatus !== "TERMINATED")
    .sort((a, b) => a.legalFirstName.localeCompare(b.legalFirstName))
    .map((m) => ({ id: m.id, legalFirstName: m.legalFirstName, legalLastName: m.legalLastName }));

  const initial: EmployeeFormValues = {
    id: employee.id,
    legalFirstName: employee.legalFirstName,
    legalLastName: employee.legalLastName,
    preferredName: employee.preferredName ?? "",
    dateOfBirth: employee.dateOfBirth ? isoDate(employee.dateOfBirth) : "",
    personalEmail: employee.personalEmail ?? "",
    personalPhone: employee.personalPhone ?? "",
    addressLine1: employee.addressLine1 ?? "",
    addressLine2: employee.addressLine2 ?? "",
    city: employee.city ?? "",
    province: employee.province ?? "",
    postalCode: employee.postalCode ?? "",
    emergencyContactName: employee.emergencyContactName ?? "",
    emergencyContactPhone: employee.emergencyContactPhone ?? "",
    emergencyContactRelation: employee.emergencyContactRelation ?? "",
    sinMasked: employee.sinLast3 ? maskSin(employee.sinLast3) : null,
    jobTitle: employee.jobTitle,
    departmentId: employee.departmentId ?? "",
    managerId: employee.managerId ?? "",
    provinceOfEmployment: employee.provinceOfEmployment,
    employeeType: employee.employeeType,
    hireDate: isoDate(employee.hireDate),
    compensationType: employee.compensationType,
    payRate: (employee.payRateCents / 100).toString(),
    payFrequency: employee.payFrequency,
    standardHoursPerWeek: employee.standardHoursPerWeek?.toString() ?? "",
    notes: employee.notes ?? "",
  };

  return (
    <>
      <PageHeader
        title={`Edit ${employee.legalFirstName} ${employee.legalLastName}`}
        breadcrumb={[
          { label: "HR", href: "/hr/employees" },
          { label: "Employees", href: "/hr/employees" },
          { label: `${employee.legalFirstName} ${employee.legalLastName}`, href: `/hr/employees/${employee.id}` },
          { label: "Edit" },
        ]}
      />
      <Card className="max-w-5xl p-5">
        <EmployeeForm initial={initial} departments={departments} managers={managers.map((m) => ({ id: m.id, name: `${m.legalFirstName} ${m.legalLastName}` }))} />
      </Card>
    </>
  );
}
