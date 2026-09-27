"use client";

import { useRouter } from "next/navigation";
import { AdminField, AdminForm, SubmitButton, adminInputClass, adminTextareaClass } from "@/components/admin/forms";
import { createStatutoryRateAction, updateStatutoryRateAction } from "./actions";

export interface StatutoryRateFormValues {
  id?: string;
  cppRate: string;
  cppBasicExemption: string;
  cppMaxPensionableEarnings: string;
  cpp2Rate: string;
  cpp2MaxPensionableEarnings: string;
  eiRate: string;
  eiEmployerMultiplier: string;
  eiMaxInsurableEarnings: string;
  effectiveFrom: string;
  effectiveTo: string;
}

const BLANK: StatutoryRateFormValues = {
  cppRate: "", cppBasicExemption: "3500", cppMaxPensionableEarnings: "",
  cpp2Rate: "4", cpp2MaxPensionableEarnings: "",
  eiRate: "", eiEmployerMultiplier: "1.4", eiMaxInsurableEarnings: "",
  effectiveFrom: "", effectiveTo: "",
};

export function StatutoryRateForm({ csrfToken, initial = BLANK }: { csrfToken: string; initial?: StatutoryRateFormValues }) {
  const router = useRouter();
  const isNew = !initial.id;

  return (
    <AdminForm
      action={isNew ? createStatutoryRateAction : updateStatutoryRateAction}
      csrfToken={csrfToken}
      onSuccess={() => {
        router.push("/admin/payroll-rates/statutory");
        router.refresh();
      }}
    >
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField label="CPP rate (%)" required hint="Employee and employer both pay this rate.">
          <input name="cppRate" type="text" inputMode="decimal" defaultValue={initial.cppRate} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <AdminField label="CPP basic exemption ($/year)" required>
          <input name="cppBasicExemption" type="text" inputMode="decimal" defaultValue={initial.cppBasicExemption} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <AdminField label="CPP maximum pensionable earnings — YMPE ($/year)" required>
          <input name="cppMaxPensionableEarnings" type="text" inputMode="decimal" defaultValue={initial.cppMaxPensionableEarnings} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <div />

        <AdminField label="CPP2 rate (%)" required>
          <input name="cpp2Rate" type="text" inputMode="decimal" defaultValue={initial.cpp2Rate} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <AdminField label="CPP2 maximum pensionable earnings — YAMPE ($/year)" required hint="Must be greater than the YMPE above.">
          <input name="cpp2MaxPensionableEarnings" type="text" inputMode="decimal" defaultValue={initial.cpp2MaxPensionableEarnings} required className={`${adminInputClass} tnum`} />
        </AdminField>

        <AdminField label="EI rate (%)" required hint="Employee rate.">
          <input name="eiRate" type="text" inputMode="decimal" defaultValue={initial.eiRate} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <AdminField label="EI employer multiplier" required hint="e.g. 1.4 — the standard, non-reduced rate.">
          <input name="eiEmployerMultiplier" type="text" inputMode="decimal" defaultValue={initial.eiEmployerMultiplier} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <AdminField label="EI maximum insurable earnings ($/year)" required>
          <input name="eiMaxInsurableEarnings" type="text" inputMode="decimal" defaultValue={initial.eiMaxInsurableEarnings} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <div />

        <AdminField label="Effective date" required hint="When this year's rates start applying.">
          <input name="effectiveFrom" type="date" defaultValue={initial.effectiveFrom} required className={adminInputClass} />
        </AdminField>
        <AdminField label="Expiry date" hint="Leave blank for an open-ended, ongoing rate.">
          <input name="effectiveTo" type="date" defaultValue={initial.effectiveTo} className={adminInputClass} />
        </AdminField>

        <div className="sm:col-span-2">
          <AdminField label="Reason" required hint="Why this rate is being published (e.g. CRA's 2026 published rates). Written to the platform audit log.">
            <textarea name="reason" rows={2} required className={adminTextareaClass} placeholder="CRA 2026 CPP/CPP2/EI rates." />
          </AdminField>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <SubmitButton tone="primary" pendingLabel="Saving…">{isNew ? "Add rate" : "Save changes"}</SubmitButton>
      </div>
    </AdminForm>
  );
}
