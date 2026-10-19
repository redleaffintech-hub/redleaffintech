import { db } from "@/lib/db";
import { requireCapability } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { EMPLOYEE_TYPES, EMPLOYEE_TYPE_LABELS } from "@/lib/hr-enums";
import { annualEntitlementHours } from "@/lib/leave-calc";
import { Badge, Card, PageHeader } from "@/components/ui";
import { EditPolicyButton, type PolicyFormValues } from "./policy-form";

export const metadata = { title: "Leave policies" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const DEFAULTS: Record<string, { unit: string; amount: string }> = {
  VACATION: { unit: "WEEKS", amount: "2" },
  SICK: { unit: "HOURS", amount: "8" },
};

export default async function LeavePoliciesPage() {
  const { company, role } = await requireCapability(CAPABILITIES.HR);
  const canEdit = can(role, CAPABILITIES.HR);

  const leaveTypes = await db.leaveType.findMany({
    where: { companyId: company.id, isActive: true, trackBalance: true },
    include: { policy: true },
  });
  // Vacation and sick first — they are tracked independently of each other and of everything else.
  const order = (category: string) => (category === "VACATION" ? 0 : category === "SICK" ? 1 : 2);
  leaveTypes.sort((a, b) => order(a.category) - order(b.category) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Leave policies"
        breadcrumb={[{ label: "HR", href: "/hr/employees" }, { label: "Time off", href: "/hr/time-off" }, { label: "Policies" }]}
        description="How much leave each employee earns, who is eligible, how a mid-year joiner is pro-rated and what carries forward. Vacation and sick leave have separate policies and separate balances."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {leaveTypes.map((type) => {
          const p = type.policy;
          const preset = DEFAULTS[type.category] ?? { unit: "DAYS", amount: "5" };
          const values: PolicyFormValues = {
            leaveTypeId: type.id,
            leaveTypeName: type.name,
            category: type.category,
            exists: Boolean(p),
            isActive: p?.isActive ?? true,
            entitlementUnit: p?.entitlementUnit ?? preset.unit,
            entitlementAmount: String(p?.entitlementAmount ?? preset.amount),
            hoursPerDay: String(p?.hoursPerDay ?? 8),
            daysPerWeek: String(p?.daysPerWeek ?? 5),
            accrualMethod: p?.accrualMethod ?? "FRONT_LOADED",
            leaveYearStartMonth: String(p?.leaveYearStartMonth ?? 1),
            eligibleEmployeeTypes: (p?.eligibleEmployeeTypes ?? EMPLOYEE_TYPES.join(",")).split(","),
            waitingPeriodDays: String(p?.waitingPeriodDays ?? 0),
            prorationMethod: p?.prorationMethod ?? "DAYS",
            carryForwardEnabled: p?.carryForwardEnabled ?? false,
            carryForwardMaxHours: p?.carryForwardMaxHours != null ? String(p.carryForwardMaxHours) : "",
            carryForwardExpiryMonths: p?.carryForwardExpiryMonths != null ? String(p.carryForwardExpiryMonths) : "",
            excessHandling: p?.excessHandling ?? "FORFEIT",
          };

          return (
            <Card key={type.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[1rem] font-semibold text-ink-950">{type.name}</h2>
                  <p className="mt-0.5 text-[0.75rem] text-muted-ink">{type.isPaid ? "Paid" : "Unpaid"} leave</p>
                </div>
                <div className="flex items-center gap-2">
                  {p ? <Badge tone={p.isActive ? "positive" : "neutral"}>{p.isActive ? "Active" : "Inactive"}</Badge> : <Badge tone="caution">No policy</Badge>}
                  {canEdit && <EditPolicyButton values={values} />}
                </div>
              </div>

              {p ? (
                <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
                  <dt className="text-muted-ink">Annual entitlement</dt>
                  <dd className="text-ink-900">
                    {p.entitlementAmount} {p.entitlementUnit.toLowerCase()}
                    {p.entitlementUnit !== "HOURS" && <span className="text-muted-ink"> ({annualEntitlementHours(p)} hours)</span>}
                  </dd>
                  <dt className="text-muted-ink">Available</dt>
                  <dd className="text-ink-900">{p.accrualMethod === "ACCRUED" ? "Accrued evenly through the year" : "All at the start of the leave year"}</dd>
                  <dt className="text-muted-ink">Leave year</dt>
                  <dd className="text-ink-900">Starts {MONTHS[p.leaveYearStartMonth - 1]} 1</dd>
                  <dt className="text-muted-ink">Eligible</dt>
                  <dd className="text-ink-900">
                    {p.eligibleEmployeeTypes.split(",").map((t) => EMPLOYEE_TYPE_LABELS[t as keyof typeof EMPLOYEE_TYPE_LABELS] ?? t).join(", ")}
                    {p.waitingPeriodDays > 0 && ` · after ${p.waitingPeriodDays} days`}
                  </dd>
                  <dt className="text-muted-ink">Mid-year joiners</dt>
                  <dd className="text-ink-900">
                    {p.prorationMethod === "DAYS" ? "Pro-rated by days remaining" : p.prorationMethod === "MONTHS" ? "Pro-rated by full months remaining" : "Not pro-rated"}
                  </dd>
                  <dt className="text-muted-ink">Carry-forward</dt>
                  <dd className="text-ink-900">
                    {p.carryForwardEnabled
                      ? `Up to ${p.carryForwardMaxHours != null ? `${p.carryForwardMaxHours}h` : "any amount"}${
                          p.carryForwardExpiryMonths ? `, expires after ${p.carryForwardExpiryMonths} month${p.carryForwardExpiryMonths === 1 ? "" : "s"}` : ", never expires"
                        }; excess ${p.excessHandling === "PAYOUT" ? "paid out" : "forfeited"}`
                      : "Off — unused leave is forfeited at year end"}
                  </dd>
                </dl>
              ) : (
                <p className="mt-4 text-[0.8125rem] text-muted-ink">
                  No policy yet, so no entitlement is calculated for this leave type. Balances for it come only from manual adjustments.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
