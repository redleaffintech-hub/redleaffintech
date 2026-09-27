"use client";

import { useRouter } from "next/navigation";
import { PROVINCES } from "@/lib/enums";
import { AdminField, AdminForm, SubmitButton, adminInputClass, adminTextareaClass } from "@/components/admin/forms";
import { createBracketAction, updateBracketAction } from "./actions";

export interface BracketFormValues {
  id?: string;
  jurisdiction: string;
  min: string;
  max: string;
  rate: string;
  basicPersonalAmount: string;
  effectiveFrom: string;
  effectiveTo: string;
}

const BLANK: BracketFormValues = {
  jurisdiction: "FEDERAL", min: "0", max: "", rate: "", basicPersonalAmount: "", effectiveFrom: "", effectiveTo: "",
};

export function BracketForm({ csrfToken, initial = BLANK }: { csrfToken: string; initial?: BracketFormValues }) {
  const router = useRouter();
  const isNew = !initial.id;

  return (
    <AdminForm
      action={isNew ? createBracketAction : updateBracketAction}
      csrfToken={csrfToken}
      onSuccess={() => {
        router.push("/admin/payroll-rates/tax-brackets");
        router.refresh();
      }}
    >
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField label="Jurisdiction" required>
          <select name="jurisdiction" defaultValue={initial.jurisdiction} required className={adminInputClass}>
            <option value="FEDERAL">Federal</option>
            {PROVINCES.map((p) => (
              <option key={p.code} value={p.code}>{p.name} ({p.code})</option>
            ))}
          </select>
        </AdminField>
        <div />

        <AdminField label="Bracket lower bound ($/year)" required hint="0 for the bottom bracket.">
          <input name="min" type="text" inputMode="decimal" defaultValue={initial.min} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <AdminField label="Bracket upper bound ($/year)" hint="Leave blank for the top, uncapped bracket.">
          <input name="max" type="text" inputMode="decimal" defaultValue={initial.max} className={`${adminInputClass} tnum`} />
        </AdminField>

        <AdminField label="Rate (%)" required>
          <input name="rate" type="text" inputMode="decimal" defaultValue={initial.rate} required className={`${adminInputClass} tnum`} />
        </AdminField>
        <AdminField label="Basic personal amount ($/year)" required hint="Repeated on every bracket row of this jurisdiction/year.">
          <input name="basicPersonalAmount" type="text" inputMode="decimal" defaultValue={initial.basicPersonalAmount} required className={`${adminInputClass} tnum`} />
        </AdminField>

        <AdminField label="Effective date" required hint="When this year's brackets start applying.">
          <input name="effectiveFrom" type="date" defaultValue={initial.effectiveFrom} required className={adminInputClass} />
        </AdminField>
        <AdminField label="Expiry date" hint="Leave blank for an open-ended, ongoing bracket.">
          <input name="effectiveTo" type="date" defaultValue={initial.effectiveTo} className={adminInputClass} />
        </AdminField>

        <div className="sm:col-span-2">
          <AdminField label="Reason" required hint="Why this bracket is being published. Written to the platform audit log.">
            <textarea name="reason" rows={2} required className={adminTextareaClass} placeholder="CRA/provincial 2026 published brackets." />
          </AdminField>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <SubmitButton tone="primary" pendingLabel="Saving…">{isNew ? "Add bracket" : "Save changes"}</SubmitButton>
      </div>
    </AdminForm>
  );
}
