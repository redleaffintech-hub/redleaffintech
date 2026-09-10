import Link from "next/link";
import {
  employees as employeesRepo,
  leaveTypes as leaveTypesRepo,
  leaveRequests as leaveRequestsRepo,
} from "@/server/db/hr";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { LEAVE_REQUEST_STATUS_LABELS } from "@/lib/hr-enums";
import { Badge, Card, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { AdjustBalanceButton, LeaveRequestRowActions, NewLeaveRequestButton } from "./time-off-client";

export const metadata = { title: "Time off" };

const STATUS_TONE: Record<string, "caution" | "positive" | "negative" | "neutral"> = {
  PENDING: "caution",
  APPROVED: "positive",
  DECLINED: "negative",
  CANCELLED: "neutral",
};

export default async function TimeOffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { company, role } = await requireCapability(CAPABILITIES.HR);
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "PENDING";

  const [allRequests, allEmployees, allLeaveTypes] = await Promise.all([
    leaveRequestsRepo.list(company.id),
    employeesRepo.list(company.id),
    leaveTypesRepo.list(company.id),
  ]);
  const employeeById = new Map(allEmployees.map((e) => [e.id, e]));
  const leaveTypeById = new Map(allLeaveTypes.map((t) => [t.id, t]));

  const statusCount = new Map<string, number>();
  for (const r of allRequests) statusCount.set(r.status, (statusCount.get(r.status) ?? 0) + 1);
  const countFor = (s: string) => statusCount.get(s) ?? 0;

  const requests = allRequests
    .filter((r) => !status || r.status === status)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100)
    .map((r) => ({
      ...r,
      employee: {
        id: r.employeeId,
        legalFirstName: employeeById.get(r.employeeId)?.legalFirstName ?? "",
        legalLastName: employeeById.get(r.employeeId)?.legalLastName ?? "",
      },
      leaveType: { name: leaveTypeById.get(r.leaveTypeId)?.name ?? "leave" },
    }));

  const employees = allEmployees
    .filter((e) => e.employmentStatus !== "TERMINATED")
    .sort((a, b) => a.legalFirstName.localeCompare(b.legalFirstName));
  const leaveTypes = allLeaveTypes
    .filter((t) => t.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  const employeeOptions = employees.map((e) => ({ id: e.id, name: `${e.legalFirstName} ${e.legalLastName}` }));
  const canEdit = can(role, CAPABILITIES.HR);

  return (
    <>
      <PageHeader
        title="Time off"
        breadcrumb={[{ label: "HR", href: "/hr/employees" }, { label: "Time off" }]}
        description="Leave requests and balance adjustments. Approving a request does not check or reduce any payroll — there is no pay run engine yet."
        actions={
          canEdit ? (
            <>
              <AdjustBalanceButton employees={employeeOptions} leaveTypes={leaveTypes} />
              <NewLeaveRequestButton employees={employeeOptions} leaveTypes={leaveTypes} />
            </>
          ) : undefined
        }
      />

      <FilterBar
        tabs={[
          { label: "Pending", value: "PENDING", count: countFor("PENDING") },
          { label: "Approved", value: "APPROVED", count: countFor("APPROVED") },
          { label: "Declined", value: "DECLINED", count: countFor("DECLINED") },
          { label: "Cancelled", value: "CANCELLED", count: countFor("CANCELLED") },
          { label: "All", value: "" },
        ]}
      />

      <Card className="p-5">
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th>Leave type</Th>
              <Th>Dates</Th>
              <Th align="right">Hours</Th>
              <Th>Status</Th>
              {canEdit && <Th align="right">{""}</Th>}
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <Tr>
                <Td colSpan={canEdit ? 6 : 5} className="py-10 text-center text-muted-ink">No leave requests here.</Td>
              </Tr>
            ) : (
              requests.map((request) => (
                <Tr key={request.id}>
                  <Td>
                    <Link href={`/hr/employees/${request.employee.id}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                      {request.employee.legalFirstName} {request.employee.legalLastName}
                    </Link>
                  </Td>
                  <Td className="text-muted-ink">{request.leaveType.name}</Td>
                  <Td className="text-muted-ink">
                    {formatDate(request.startDate)}
                    {request.endDate.getTime() !== request.startDate.getTime() ? ` – ${formatDate(request.endDate)}` : ""}
                  </Td>
                  <Td align="right" className="tnum">{request.hours}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[request.status] ?? "neutral"}>
                      {LEAVE_REQUEST_STATUS_LABELS[request.status as keyof typeof LEAVE_REQUEST_STATUS_LABELS] ?? request.status}
                    </Badge>
                  </Td>
                  {canEdit && (
                    <Td align="right">
                      <LeaveRequestRowActions request={{ id: request.id, status: request.status }} />
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
