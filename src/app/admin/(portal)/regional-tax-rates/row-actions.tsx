"use client";

import Link from "next/link";
import { ConfirmAction } from "@/components/admin/forms";
import { deleteRateAction, endRateAction, setRateActiveAction } from "./actions";

export function RegionalTaxRateRowActions({
  csrfToken,
  rateId,
  regionLabel,
  isFuture,
  isActive,
}: {
  csrfToken: string;
  rateId: string;
  regionLabel: string;
  isFuture: boolean;
  isActive: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {isFuture && (
        <>
          <Link
            href={`/admin/regional-tax-rates/${rateId}/edit`}
            className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
          >
            Edit
          </Link>

          {/* Only ever offered for a rate that hasn't taken effect yet — once
              published, End (close its range) is the only way to retire one,
              so the history stays intact. */}
          <ConfirmAction
            action={deleteRateAction}
            csrfToken={csrfToken}
            label="Delete"
            title={`Delete the future rate for ${regionLabel}`}
            description="Permanent — this rate has never taken effect, so nothing depends on it. Choose End instead for a rate already in force."
            confirmLabel="Delete rate"
            reasonRequired
            reasonLabel="Reason"
            hidden={{ id: rateId }}
          />
        </>
      )}

      <ConfirmAction
        action={endRateAction}
        csrfToken={csrfToken}
        label="End"
        title={`End the rate for ${regionLabel}`}
        description="Sets an expiry date rather than deleting the row — its history stays intact and visible."
        confirmLabel="End rate"
        reasonRequired
        reasonLabel="Reason"
        hidden={{ id: rateId }}
        extraFields={
          <div className="mb-3">
            <label className="mb-1 block text-[0.75rem] font-medium text-ink-800">
              Ends on <span className="text-negative">*</span>
            </label>
            <input
              type="date"
              name="effectiveTo"
              required
              className="h-9 w-full rounded-lg border border-paper-400 bg-white px-3 text-[0.8125rem] text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        }
      />

      <ConfirmAction
        action={setRateActiveAction}
        csrfToken={csrfToken}
        label={isActive ? "Deactivate" : "Activate"}
        title={`${isActive ? "Deactivate" : "Activate"} the rate for ${regionLabel}`}
        description={
          isActive
            ? "An inactive rate is skipped when the platform resolves the current regime for this province."
            : "Makes this rate eligible to be resolved as the current regime for this province again."
        }
        tone={isActive ? "danger" : "primary"}
        hidden={{ id: rateId, isActive: isActive ? "false" : "true" }}
      />
    </div>
  );
}
