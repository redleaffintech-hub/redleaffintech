import { departments as departmentsRepo, employees as employeesRepo } from "@/server/db/hr";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { AddDepartmentButton, DepartmentRowActions } from "./departments-client";

export const metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  const { company, role } = await requireCapability(CAPABILITIES.HR);

  const [rawDepartments, allEmployees] = await Promise.all([
    departmentsRepo.list(company.id),
    employeesRepo.list(company.id),
  ]);
  const countByDept = new Map<string, number>();
  for (const e of allEmployees) {
    if (e.departmentId) countByDept.set(e.departmentId, (countByDept.get(e.departmentId) ?? 0) + 1);
  }
  const departments = [...rawDepartments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ ...d, _count: { employees: countByDept.get(d.id) ?? 0 } }));

  const canEdit = can(role, CAPABILITIES.HR);

  return (
    <>
      <PageHeader
        title="Departments"
        breadcrumb={[{ label: "HR", href: "/hr/employees" }, { label: "Departments" }]}
        description="Group employees for reporting. A department cannot be deleted while employees are assigned to it."
        actions={canEdit ? <AddDepartmentButton /> : undefined}
      />

      <Card className="p-5">
        <Table>
          <thead>
            <tr>
              <Th>Department</Th>
              <Th align="right">Employees</Th>
              {canEdit && <Th align="right">{""}</Th>}
            </tr>
          </thead>
          <tbody>
            {departments.length === 0 ? (
              <Tr>
                <Td colSpan={canEdit ? 3 : 2} className="py-10 text-center text-muted-ink">
                  No departments yet.
                </Td>
              </Tr>
            ) : (
              departments.map((department) => (
                <Tr key={department.id}>
                  <Td className="font-medium text-ink-900">{department.name}</Td>
                  <Td align="right" className="tnum text-muted-ink">{department._count.employees}</Td>
                  {canEdit && (
                    <Td align="right">
                      <DepartmentRowActions department={{ id: department.id, name: department.name, employeeCount: department._count.employees }} />
                    </Td>
                  )}
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
