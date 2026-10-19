import Link from "next/link";
import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { hoursLabel } from "@/lib/leave-format";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { leaveTrackers, syncLeaveLedger, type TrackerRow } from "@/server/hr/leave-policy";
import { AdjustBalanceButton } from "../time-off-client";
import { RunYearEndButton } from "./year-end-button";

export const metadata = { title: "Leave balances" };

export default async function LeaveBalancesPage() {
  const { company, role, user } = await requireCapability(CAPABILITIES.HR);
  const canEdit = can(role, CAPABILITIES.HR);

  // Idempotent: writes any carry-forward / expiry record now due, otherwise a no-op.
  await syncLeaveLedger(company.id, user.id);

  const [rows, employees, leaveTypes] = await Promise.all([
    leaveTrackers(company.id),
    db.employee.findMany({
      where: { companyId: company.id, employmentStatus: { not: "TERMINATED" } },
      orderBy: { legalFirstName: "asc" },
      select: { id: true, legalFirstName: true, legalLastName: true },
    }),
    db.leaveType.findMany({ where: { companyId: company.id, isActive: true, trackBalance: true }, orderBy: { name: "asc" } }),
  ]);

  // One section per leave type: vacation and sick are never mixed into one figure.
  const byType = new Map<string, TrackerRow[]>();
  for (const row of rows) byType.set(row.leaveTypeId, [...(byType.get(row.leaveTypeId) ?? []), row]);
  const order = (category: string) => (category === "VACATION" ? 0 : category === "SICK" ? 1 : 2);
  const sections = [...byType.values()].sort((a, b) => order(a[0].category) - order(b[0].category) || a[0].leaveTypeName.localeCompare(b[0].leaveTypeName));

  const totalPending = rows.reduce((s, r) => s + r.tracker.pendingHours, 0);
  const employeeOptions = employees.map((e) => ({ id: e.id, name: `${e.legalFirstName} ${e.legalLastName}` }));

  return (
    <>
      <PageHeader
        title="Leave balances"
        breadcrumb={[{ label: "HR", href: "/hr/employees" }, { label: "Time off", href: "/hr/time-off" }, { label: "Balances" }]}
        description="Every employee's entitlement, accrual, carry-forward, usage and remaining balance — vacation and sick leave tracked separately, recalculated automatically from the leave policy and approved requests."
        actions={
          canEdit ? (
            <>
              <LinkButton href="/hr/time-off/policies">Policies</LinkButton>
              <AdjustBalanceButton employees={employeeOptions} leaveTypes={leaveTypes} />
              <RunYearEndButton />
            </>
          ) : undefined
        }
      />

      {sections.length === 0 ? (
        <Card className="p-8 text-center text-[0.875rem] text-muted-ink">
          No leave policies are set up yet. <Link href="/hr/time-off/policies" className="text-brand-700 hover:underline">Set up a vacation or sick leave policy</Link> to start tracking balances.
        </Card>
      ) : (
        <div className="space-y-5">
          {totalPending > 0 && (
            <p className="text-[0.8125rem] text-muted-ink">
              {totalPending}h of leave is waiting for approval. <Link href="/hr/time-off" className="text-brand-700 hover:underline">Review requests →</Link>
            </p>
          )}
          {sections.map((section) => {
            const first = section[0];
            const policy = first.policy;
            return (
              <Card key={first.leaveTypeId} className="p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[1rem] font-semibold text-ink-950">{first.leaveTypeName}</h2>
                  <p className="text-[0.75rem] text-muted-ink">
                    Leave year {first.tracker.year}
                    {" · "}
                    {formatDate(first.tracker.yearStart)} – {formatDate(first.tracker.yearEnd)} · as of {formatDate(first.asOf)}
                    {" · "}
                    {policy.accrualMethod === "ACCRUED" ? "accrued daily" : "granted up front"}
                  </p>
                </div>
                <div className="thin-scroll overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Employee</Th>
                        <Th align="right">Annual entitlement</Th>
                        <Th align="right">Allocated to date</Th>
                        <Th align="right">Carried forward</Th>
                        <Th align="right">Adjustments</Th>
                        <Th align="right">Used</Th>
                        <Th align="right">Pending</Th>
                        <Th align="right">Remaining</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.map((row) => {
                        const t = row.tracker;
                        return (
                          <Tr key={row.employeeId}>
                            <Td>
                              <Link href={`/hr/employees/${row.employeeId}`} className="font-medium text-ink-900 hover:text-brand-700 hover:underline">
                                {row.employeeName}
                              </Link>
                              {!t.entitlement.eligible && <Badge tone="neutral" className="ml-2">Not eligible</Badge>}
                              <p className="mt-0.5 text-[0.6875rem] text-muted-ink">{t.entitlement.explanation}</p>
                            </Td>
                            <Td align="right" className="tnum">{hoursLabel(t.entitlement.proratedHours, policy)}</Td>
                            <Td align="right" className="tnum">{hoursLabel(t.allocatedHours, policy)}</Td>
                            <Td align="right" className="tnum">
                              {t.carriedForwardHours > 0 ? hoursLabel(t.carriedForwardHours, policy) : "—"}
                              {t.carriedForwardHours > 0 && t.carryExpiresOn && (
                                <p className="text-[0.6875rem] text-muted-ink">
                                  {t.expiredHours > 0 ? `${t.expiredHours}h expired ${formatDate(t.carryExpiresOn)}` : `expires ${formatDate(t.carryExpiresOn)}`}
                                </p>
                              )}
                            </Td>
                            <Td align="right" className="tnum">{t.adjustmentHours !== 0 ? hoursLabel(t.adjustmentHours, policy) : "—"}</Td>
                            <Td align="right" className="tnum">{hoursLabel(t.usedHours, policy)}</Td>
                            <Td align="right" className="tnum">{t.pendingHours > 0 ? hoursLabel(t.pendingHours, policy) : "—"}</Td>
                            <Td align="right" className={t.remainingHours < 0 ? "tnum font-semibold text-negative" : "tnum font-semibold text-ink-950"}>
                              {hoursLabel(t.remainingHours, policy)}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
