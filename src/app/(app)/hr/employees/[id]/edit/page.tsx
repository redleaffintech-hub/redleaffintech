import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES } from "@/lib/permissions";
import { isoDate } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui";
import { maskSin } from "@/server/hr/employment-standards";
import { EmployeeForm, type EmployeeFormValues } from "../../employee-form";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCapability(CAPABILITIES.HR);
  const { id } = await params;

  const [employee, departments, managers] = await Promise.all([
    db.employee.findFirst({ where: { id, companyId: company.id } }),
    db.department.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employee.findMany({
      where: { companyId: company.id, employmentStatus: { not: "TERMINATED" } },
      orderBy: { legalFirstName: "asc" },
      select: { id: true, legalFirstName: true, legalLastName: true },
    }),
  ]);
  if (!employee) notFound();

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
