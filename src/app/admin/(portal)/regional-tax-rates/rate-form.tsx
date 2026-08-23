"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import clsx from "clsx";
import { AdminField, AdminForm, FormError, SubmitButton, adminInputClass, adminTextareaClass } from "@/components/admin/forms";
import { PROVINCES } from "@/lib/enums";
import { FEDERAL_TYPES, PROVINCIAL_TYPES } from "@/lib/tax/regional-rate-types";
import { createRateAction, updateRateAction } from "./actions";

export interface RateFormValues {
  id?: string;
  province: string;
  federalType: string;
  federalRate: string;
  provincialType: string;
  provincialRate: string;
  effectiveFrom: string;
  effectiveTo: string;
}

const BLANK: RateFormValues = {
  province: "",
  federalType: "GST",
  federalRate: "5",
  provincialType: "NONE",
  provincialRate: "0",
  effectiveFrom: "",
  effectiveTo: "",
};

const PROVINCE_LABEL: Map<string, string> = new Map(PROVINCES.map((p) => [p.code, p.name]));

/** What the confirmation step shows, read out of the form right before it opens. */
interface PendingSummary {
  province: string;
  federalType: string;
  federalRate: string;
  provincialType: string;
  provincialRate: string;
  effectiveFrom: string;
  effectiveTo: string;
  reason: string;
}

/**
 * Add / edit form, shared by /new and /[id]/edit.
 *
 * Only ever reachable for a genuinely future, unpublished rate — the list page
 * only links here for those, and `updateRateAction` refuses the save anyway if
 * the rate has come into force since the page was opened.
 *
 * Publishing is a two-step submit: "Review change" validates and freezes a
 * summary of what is about to go live, then a second, explicit "Confirm &
 * publish" click submits it. A reason is required to reach that second step —
 * every regional rate this action can produce ships with one in the audit log.
 */
export function RateForm({ csrfToken, initial = BLANK }: { csrfToken: string; initial?: RateFormValues }) {
  const router = useRouter();
  const isNew = !initial.id;
  const [federalType, setFederalType] = useState(initial.federalType);
  const [provincialType, setProvincialType] = useState(initial.provincialType);
  const [pending, setPending] = useState<PendingSummary | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const provincialLocked = federalType === "HST";

  function review(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    if (!form) return;
    if (!form.reportValidity()) return;

    const data = new FormData(form);
    const reason = String(data.get("reason") ?? "").trim();
    if (!reason) {
      setReviewError("Give a reason for this rate change — it is required and goes to the platform audit log.");
      return;
    }

    setReviewError(null);
    setPending({
      province: String(data.get("province") ?? ""),
      federalType: String(data.get("federalType") ?? ""),
      federalRate: String(data.get("federalRate") ?? ""),
      provincialType: String(data.get("provincialType") ?? ""),
      provincialRate: String(data.get("provincialRate") ?? ""),
      effectiveFrom: String(data.get("effectiveFrom") ?? ""),
      effectiveTo: String(data.get("effectiveTo") ?? ""),
      reason,
    });
  }

  return (
    <AdminForm
      action={isNew ? createRateAction : updateRateAction}
      csrfToken={csrfToken}
      onSuccess={() => {
        router.push("/admin/regional-tax-rates");
        router.refresh();
      }}
    >
      {initial.id && <input type="hidden" name="id" value={initial.id} />}

      {/* Fields stay mounted (just visually hidden) during the confirm step, so their
          values are still part of the form that actually submits. */}
      <div className={clsx("grid gap-4 sm:grid-cols-2", pending && "hidden")}>
        <AdminField label="Province or territory" required>
          <select name="province" defaultValue={initial.province} required className={adminInputClass}>
            <option value="" disabled>Choose…</option>
            {PROVINCES.map((p) => (
              <option key={p.code} value={p.code}>{p.name} ({p.code})</option>
            ))}
          </select>
        </AdminField>

        <div />

        <AdminField label="Federal tax type" required>
          <select
            name="federalType"
            value={federalType}
            onChange={(event) => {
              const next = event.target.value;
              setFederalType(next);
              if (next === "HST") setProvincialType("NONE");
            }}
            className={adminInputClass}
          >
            {FEDERAL_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </AdminField>
        <AdminField label="GST/HST rate (%)" required hint="e.g. 5 or 13.5">
          <input name="federalRate" type="text" inputMode="decimal" defaultValue={initial.federalRate} required className={clsx(adminInputClass, "tnum")} />
        </AdminField>

        <AdminField
          label="Provincial tax type"
          hint={provincialLocked ? "An HST province has no separate provincial tax." : undefined}
        >
          <select
            name="provincialType"
            value={provincialType}
            disabled={provincialLocked}
            onChange={(event) => setProvincialType(event.target.value)}
            className={clsx(adminInputClass, provincialLocked && "cursor-not-allowed bg-paper-100 text-ink-400")}
          >
            {PROVINCIAL_TYPES.map((t) => (
              <option key={t} value={t}>{t === "NONE" ? "None" : t}</option>
            ))}
          </select>
          {provincialLocked && <input type="hidden" name="provincialType" value="NONE" />}
        </AdminField>
        <AdminField label="Provincial tax rate (%)" hint={provincialType === "NONE" ? "No separate provincial tax." : "e.g. 7"}>
          <input
            name="provincialRate"
            type="text"
            inputMode="decimal"
            defaultValue={provincialType === "NONE" ? "0" : initial.provincialRate}
            disabled={provincialType === "NONE"}
            className={clsx(adminInputClass, "tnum", provincialType === "NONE" && "cursor-not-allowed bg-paper-100 text-ink-400")}
          />
          {provincialType === "NONE" && <input type="hidden" name="provincialRate" value="0" />}
        </AdminField>

        <AdminField label="Effective date" required hint="When this regime starts applying.">
          <input name="effectiveFrom" type="date" defaultValue={initial.effectiveFrom} required className={adminInputClass} />
        </AdminField>
        <AdminField label="Expiry date" hint="Leave blank for an open-ended, ongoing rate.">
          <input name="effectiveTo" type="date" defaultValue={initial.effectiveTo} className={adminInputClass} />
        </AdminField>

        <div className="sm:col-span-2">
          <AdminField label="Reason" required hint="Why this rate is being published. Written to the platform audit log.">
            <textarea name="reason" rows={2} required className={adminTextareaClass} placeholder="Provincial budget announcement, effective April 2026." />
          </AdminField>
        </div>
      </div>

      {pending && (
        <div className="rounded-lg border border-[color:var(--color-caution)]/35 bg-caution-soft/60 p-4">
          <p className="text-[0.875rem] font-semibold text-ink-900">
            Confirm {isNew ? "publishing" : "saving"} this rate for {PROVINCE_LABEL.get(pending.province) ?? pending.province}
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-[0.8125rem] leading-6 text-ink-700 sm:grid-cols-2">
            <Row label="Federal" value={`${pending.federalType} ${pending.federalRate}%`} />
            <Row
              label="Provincial"
              value={pending.provincialType === "NONE" ? "None" : `${pending.provincialType} ${pending.provincialRate}%`}
            />
            <Row label="Effective" value={pending.effectiveFrom} />
            <Row label="Expiry" value={pending.effectiveTo || "Ongoing"} />
          </dl>
          <p className="mt-2 text-[0.8125rem] leading-6 text-ink-700">
            <span className="font-medium text-ink-800">Reason: </span>
            {pending.reason}
          </p>
          <p className="mt-2 text-[0.75rem] leading-5 text-muted-ink">
            {isNew
              ? "New tax codes provisioned for this region will use this rate from the effective date. Nothing already posted changes."
              : "This rate has not taken effect yet, so it is safe to correct directly rather than being superseded."}
          </p>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
            >
              Back
            </button>
            <SubmitButton tone="primary" pendingLabel="Publishing…">
              {isNew ? "Confirm & publish" : "Confirm & save"}
            </SubmitButton>
          </div>
        </div>
      )}

      {reviewError && <FormError>{reviewError}</FormError>}

      {!pending && (
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={review}
            className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3.5 text-[0.8125rem] font-medium text-white hover:bg-brand-700"
          >
            Review change
          </button>
        </div>
      )}
    </AdminForm>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium text-ink-900">{value}</dd>
    </div>
  );
}
