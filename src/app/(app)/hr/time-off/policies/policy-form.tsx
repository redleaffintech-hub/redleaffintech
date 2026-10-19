"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { EMPLOYEE_TYPES, EMPLOYEE_TYPE_LABELS } from "@/lib/hr-enums";
import { saveLeavePolicyAction } from "./actions";

export interface PolicyFormValues {
  leaveTypeId: string;
  leaveTypeName: string;
  category: string;
  exists: boolean;
  isActive: boolean;
  entitlementUnit: string;
  entitlementAmount: string;
  hoursPerDay: string;
  daysPerWeek: string;
  accrualMethod: string;
  leaveYearStartMonth: string;
  eligibleEmployeeTypes: string[];
  waitingPeriodDays: string;
  prorationMethod: string;
  carryForwardEnabled: boolean;
  carryForwardMaxHours: string;
  carryForwardExpiryMonths: string;
  excessHandling: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Quick-pick entitlements per category; "custom" leaves the unit and amount free. */
const PRESETS: Record<string, { label: string; unit: string; amount: string }[]> = {
  VACATION: [
    { label: "2 weeks", unit: "WEEKS", amount: "2" },
    { label: "3 weeks", unit: "WEEKS", amount: "3" },
    { label: "4 weeks", unit: "WEEKS", amount: "4" },
  ],
  SICK: [
    { label: "8 hours", unit: "HOURS", amount: "8" },
    { label: "16 hours", unit: "HOURS", amount: "16" },
  ],
};

export function EditPolicyButton({ values }: { values: PolicyFormValues }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [unit, setUnit] = useState(values.entitlementUnit);
  const [amount, setAmount] = useState(values.entitlementAmount);
  const [carry, setCarry] = useState(values.carryForwardEnabled);

  const presets = PRESETS[values.category] ?? [];
  const activePreset = presets.find((p) => p.unit === unit && p.amount === amount)?.label ?? "custom";

  return (
    <>
      <Button variant={values.exists ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {values.exists ? "Edit policy" : "Set up policy"}
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} size="lg" title={`${values.leaveTypeName} leave policy`}
          description="Entitlement, eligibility, pro-rating and carry-forward. Balances are recalculated from this policy, so changes apply to the current leave year onward.">
          <form
            action={async (formData) => {
              if (saving) return;
              setSaving(true);
              setError(null);
              const result = await saveLeavePolicyAction(formData);
              setSaving(false);
              if (result?.error) return setError(result.error);
              setOpen(false);
              router.refresh();
            }}
            className="space-y-5"
          >
            <input type="hidden" name="leaveTypeId" value={values.leaveTypeId} />

            <fieldset className="space-y-3">
              <legend className="mb-1 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Annual entitlement</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Quick pick">
                  <Select
                    value={activePreset}
                    onChange={(event) => {
                      const preset = presets.find((p) => p.label === event.target.value);
                      if (preset) {
                        setUnit(preset.unit);
                        setAmount(preset.amount);
                      }
                    }}
                  >
                    {presets.map((p) => (
                      <option key={p.label} value={p.label}>{p.label}</option>
                    ))}
                    <option value="custom">Custom</option>
                  </Select>
                </Field>
                <Field label="Amount" required>
                  <input name="entitlementAmount" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} required />
                </Field>
                <Field label="Unit" required>
                  <Select name="entitlementUnit" value={unit} onChange={(e) => setUnit(e.target.value)}>
                    <option value="WEEKS">Weeks</option>
                    <option value="DAYS">Days</option>
                    <option value="HOURS">Hours</option>
                  </Select>
                </Field>
                {unit !== "HOURS" && (
                  <Field label="Hours per working day" hint="Converts days and weeks into hours.">
                    <input name="hoursPerDay" type="text" inputMode="decimal" defaultValue={values.hoursPerDay} className={inputClass} />
                  </Field>
                )}
                {unit === "WEEKS" && (
                  <Field label="Working days per week">
                    <input name="daysPerWeek" type="text" inputMode="decimal" defaultValue={values.daysPerWeek} className={inputClass} />
                  </Field>
                )}
                {unit === "HOURS" && <input type="hidden" name="hoursPerDay" value={values.hoursPerDay} />}
                {unit !== "WEEKS" && <input type="hidden" name="daysPerWeek" value={values.daysPerWeek} />}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="How leave becomes available">
                  <Select name="accrualMethod" defaultValue={values.accrualMethod}>
                    <option value="FRONT_LOADED">All at the start of the leave year</option>
                    <option value="ACCRUED">Accrued evenly through the year</option>
                  </Select>
                </Field>
                <Field label="Leave year starts">
                  <Select name="leaveYearStartMonth" defaultValue={values.leaveYearStartMonth}>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>{m} 1</option>
                    ))}
                  </Select>
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Eligibility</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {EMPLOYEE_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-1.5 text-[0.8125rem] text-ink-900">
                    <input
                      type="checkbox"
                      name="eligibleEmployeeTypes"
                      value={type}
                      defaultChecked={values.eligibleEmployeeTypes.includes(type)}
                      className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
                    />
                    {EMPLOYEE_TYPE_LABELS[type]}
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Waiting period (days after hire)" hint="Leave starts counting once this many days have passed since the hire date.">
                  <input name="waitingPeriodDays" type="text" inputMode="numeric" defaultValue={values.waitingPeriodDays} className={inputClass} />
                </Field>
                <Field label="Pro-rate for mid-year joiners" hint="Applied when an employee becomes eligible part-way through the leave year.">
                  <Select name="prorationMethod" defaultValue={values.prorationMethod}>
                    <option value="DAYS">By days remaining in the year</option>
                    <option value="MONTHS">By full months remaining</option>
                    <option value="NONE">Don&apos;t pro-rate (full entitlement)</option>
                  </Select>
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Carry-forward</legend>
              <label className="flex items-center gap-2 text-[0.8125rem] text-ink-900">
                <input
                  type="checkbox"
                  name="carryForwardEnabled"
                  checked={carry}
                  onChange={(e) => setCarry(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
                />
                Carry unused leave into the next leave year
              </label>
              {carry && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Maximum to carry (hours)" hint="Blank = no limit.">
                    <input name="carryForwardMaxHours" type="text" inputMode="decimal" defaultValue={values.carryForwardMaxHours} className={inputClass} />
                  </Field>
                  <Field label="Expires after (months)" hint="Blank = carried leave never expires.">
                    <input name="carryForwardExpiryMonths" type="text" inputMode="numeric" defaultValue={values.carryForwardExpiryMonths} className={inputClass} />
                  </Field>
                  <Field label="Hours above the limit">
                    <Select name="excessHandling" defaultValue={values.excessHandling}>
                      <option value="FORFEIT">Forfeit</option>
                      <option value="PAYOUT">Pay out (recorded only)</option>
                    </Select>
                  </Field>
                </div>
              )}
              {!carry && <input type="hidden" name="excessHandling" value={values.excessHandling} />}
            </fieldset>

            <label className="flex items-center gap-2 text-[0.8125rem] text-ink-900">
              <input type="checkbox" name="isActive" defaultChecked={values.isActive} className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]" />
              Policy is active
            </label>

            {error && (
              <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save policy"}</Button>
              <Button type="button" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
