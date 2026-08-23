"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { PROVINCES } from "@/lib/enums";
import {
  COMPENSATION_TYPES,
  EMPLOYEE_TYPE_LABELS,
  EMPLOYEE_TYPES,
  PAY_FREQUENCIES,
  PAY_FREQUENCY_LABELS,
} from "@/lib/hr-enums";
import { Button, Field, SectionDivider, Select, inputClass } from "@/components/ui";
import { createEmployeeAction, updateEmployeeAction } from "./actions";

export interface EmployeeFormValues {
  id?: string;
  legalFirstName: string;
  legalLastName: string;
  preferredName: string;
  dateOfBirth: string;
  personalEmail: string;
  personalPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  sinMasked: string | null;
  jobTitle: string;
  departmentId: string;
  managerId: string;
  provinceOfEmployment: string;
  employeeType: string;
  hireDate: string;
  compensationType: string;
  payRate: string;
  payFrequency: string;
  standardHoursPerWeek: string;
  notes: string;
}

export function blankEmployee(companyProvince: string): EmployeeFormValues {
  return {
    legalFirstName: "", legalLastName: "", preferredName: "", dateOfBirth: "",
    personalEmail: "", personalPhone: "",
    addressLine1: "", addressLine2: "", city: "", province: "", postalCode: "",
    emergencyContactName: "", emergencyContactPhone: "", emergencyContactRelation: "",
    sinMasked: null,
    jobTitle: "", departmentId: "", managerId: "",
    provinceOfEmployment: companyProvince, employeeType: "FULL_TIME", hireDate: "",
    compensationType: "SALARY", payRate: "", payFrequency: "BIWEEKLY", standardHoursPerWeek: "40",
    notes: "",
  };
}

export function EmployeeForm({
  initial,
  departments,
  managers,
}: {
  initial: EmployeeFormValues;
  departments: { id: string; name: string }[];
  managers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const isNew = !initial.id;
  const [compensationType, setCompensationType] = useState(initial.compensationType);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      action={async (formData) => {
        if (saving) return;
        setSaving(true);
        setError(null);
        const action = isNew ? createEmployeeAction : updateEmployeeAction;
        const result = await action(formData);
        setSaving(false);
        if (result?.error) {
          setError(result.error);
          return;
        }
        if (result?.employeeId) router.push(`/hr/employees/${result.employeeId}`);
      }}
      className="space-y-6"
    >
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <section>
        <SectionDivider label="Personal" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Legal first name" required>
            <input name="legalFirstName" defaultValue={initial.legalFirstName} required maxLength={80} className={inputClass} />
          </Field>
          <Field label="Legal last name" required>
            <input name="legalLastName" defaultValue={initial.legalLastName} required maxLength={80} className={inputClass} />
          </Field>
          <Field label="Preferred name" hint="Shown in place of the legal first name where it appears in the app.">
            <input name="preferredName" defaultValue={initial.preferredName} maxLength={80} className={inputClass} />
          </Field>
          <Field label="Date of birth">
            <input type="date" name="dateOfBirth" defaultValue={initial.dateOfBirth} className={inputClass} />
          </Field>
          <Field label="Personal email">
            <input type="email" name="personalEmail" defaultValue={initial.personalEmail} maxLength={120} className={inputClass} />
          </Field>
          <Field label="Personal phone">
            <input name="personalPhone" defaultValue={initial.personalPhone} maxLength={40} className={inputClass} />
          </Field>
          <Field
            label="Social Insurance Number"
            hint={
              initial.sinMasked
                ? `On file: ${initial.sinMasked}. Leave blank to keep it unchanged.`
                : "Validated against the CRA check-digit formula. Stored as a fingerprint only — never in a reversible form."
            }
          >
            <input name="sin" placeholder={initial.sinMasked ?? "046 454 286"} maxLength={20} className={clsx(inputClass, "tnum")} />
          </Field>
        </div>
      </section>

      <section>
        <SectionDivider label="Home address" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Address line 1" className="lg:col-span-2">
            <input name="addressLine1" defaultValue={initial.addressLine1} maxLength={120} className={inputClass} />
          </Field>
          <Field label="Address line 2">
            <input name="addressLine2" defaultValue={initial.addressLine2} maxLength={120} className={inputClass} />
          </Field>
          <Field label="City">
            <input name="city" defaultValue={initial.city} maxLength={80} className={inputClass} />
          </Field>
          <Field label="Province">
            <Select name="province" defaultValue={initial.province}>
              <option value="">—</option>
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Postal code">
            <input name="postalCode" defaultValue={initial.postalCode} maxLength={12} className={inputClass} />
          </Field>
        </div>
      </section>

      <section>
        <SectionDivider label="Emergency contact" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <input name="emergencyContactName" defaultValue={initial.emergencyContactName} maxLength={120} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="emergencyContactPhone" defaultValue={initial.emergencyContactPhone} maxLength={40} className={inputClass} />
          </Field>
          <Field label="Relationship">
            <input name="emergencyContactRelation" defaultValue={initial.emergencyContactRelation} maxLength={60} className={inputClass} />
          </Field>
        </div>
      </section>

      <section>
        <SectionDivider label="Employment" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Job title" required>
            <input name="jobTitle" defaultValue={initial.jobTitle} required maxLength={120} className={inputClass} />
          </Field>
          <Field label="Department">
            <Select name="departmentId" defaultValue={initial.departmentId}>
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reports to">
            <Select name="managerId" defaultValue={initial.managerId}>
              <option value="">No manager</option>
              {managers.filter((m) => m.id !== initial.id).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Province of employment"
            required
            hint="Determines which province's employment standards and statutory holidays apply."
          >
            <Select name="provinceOfEmployment" defaultValue={initial.provinceOfEmployment} required>
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Employee type" required>
            <Select name="employeeType" defaultValue={initial.employeeType} required>
              {EMPLOYEE_TYPES.map((t) => (
                <option key={t} value={t}>{EMPLOYEE_TYPE_LABELS[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Hire date" required>
            <input type="date" name="hireDate" defaultValue={initial.hireDate} required className={inputClass} />
          </Field>
        </div>
      </section>

      <section>
        <SectionDivider label="Compensation" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Compensation type" required>
            <Select
              name="compensationType"
              value={compensationType}
              onChange={(event) => setCompensationType(event.target.value)}
              required
            >
              {COMPENSATION_TYPES.map((t) => (
                <option key={t} value={t}>{t === "SALARY" ? "Salary" : "Hourly"}</option>
              ))}
            </Select>
          </Field>
          <Field
            label={compensationType === "SALARY" ? "Annual salary ($)" : "Hourly rate ($)"}
            required
          >
            <input name="payRate" type="text" inputMode="decimal" defaultValue={initial.payRate} required className={clsx(inputClass, "tnum")} />
          </Field>
          <Field label="Pay frequency" required>
            <Select name="payFrequency" defaultValue={initial.payFrequency} required>
              {PAY_FREQUENCIES.map((f) => (
                <option key={f} value={f}>{PAY_FREQUENCY_LABELS[f]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Standard hours / week">
            <input name="standardHoursPerWeek" type="text" inputMode="decimal" defaultValue={initial.standardHoursPerWeek} className={clsx(inputClass, "tnum")} />
          </Field>
        </div>
      </section>

      <section>
        <SectionDivider label="Notes" />
        <Field label="Internal notes">
          <textarea name="notes" defaultValue={initial.notes} rows={3} className={inputClass} />
        </Field>
      </section>

      {error && (
        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : isNew ? "Add employee" : "Save changes"}
        </Button>
        <Button type="button" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
