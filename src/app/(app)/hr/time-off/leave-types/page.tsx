import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { LEAVE_CATEGORY_LABELS } from "@/lib/hr-enums";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { AddLeaveTypeButton, LeaveTypeRowActions } from "./leave-types-client";

export const metadata = { title: "Leave types" };

export default async function LeaveTypesPage() {
  const { company, role } = await requireCapability(CAPABILITIES.HR);
  const leaveTypes = await db.leaveType.findMany({ where: { companyId: company.id }, orderBy: { name: "asc" } });
  const canEdit = can(role, CAPABILITIES.HR);

  return (
    <>
      <PageHeader
        title="Leave types"
        breadcrumb={[{ label: "HR", href: "/hr/employees" }, { label: "Time off", href: "/hr/time-off" }, { label: "Leave types" }]}
        description="The leave policies employees can request against. Every new company starts with a common Canadian set — vacation, sick, and the job-protected statutory leaves — which are all editable here."
        actions={canEdit ? <AddLeaveTypeButton /> : undefined}
      />

      <Card className="p-5">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Category</Th>
              <Th>Paid</Th>
              <Th>Tracks balance</Th>
              <Th>Status</Th>
              {canEdit && <Th align="right">{""}</Th>}
            </tr>
          </thead>
          <tbody>
            {leaveTypes.length === 0 ? (
              <Tr>
                <Td colSpan={canEdit ? 6 : 5} className="py-10 text-center text-muted-ink">No leave types yet.</Td>
              </Tr>
            ) : (
              leaveTypes.map((type) => (
                <Tr key={type.id}>
                  <Td className="font-medium text-ink-900">{type.name}</Td>
                  <Td className="text-muted-ink">{LEAVE_CATEGORY_LABELS[type.category as keyof typeof LEAVE_CATEGORY_LABELS] ?? type.category}</Td>
                  <Td className="text-muted-ink">{type.isPaid ? "Yes" : "No"}</Td>
                  <Td className="text-muted-ink">{type.trackBalance ? "Yes" : "No"}</Td>
                  <Td><Badge tone={type.isActive ? "positive" : "neutral"}>{type.isActive ? "Active" : "Inactive"}</Badge></Td>
                  {canEdit && (
                    <Td align="right">
                      <LeaveTypeRowActions leaveType={type} />
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
