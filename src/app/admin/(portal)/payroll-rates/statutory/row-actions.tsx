"use client";

import Link from "next/link";
import { ConfirmAction } from "@/components/admin/forms";
import { deleteStatutoryRateAction, endStatutoryRateAction } from "./actions";

export function StatutoryRateRowActions({
  csrfToken,
  rateId,
  isFuture,
}: {
  csrfToken: string;
  rateId: string;
  isFuture: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {isFuture && (
        <>
          <Link
            href={`/admin/payroll-rates/statutory/${rateId}/edit`}
            className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
          >
            Edit
          </Link>
          <ConfirmAction
            action={deleteStatutoryRateAction}
            csrfToken={csrfToken}
            label="Delete"
            title="Delete this future rate"
            description="Permanent — this rate has never taken effect, so nothing depends on it. Choose End instead for a rate already in force."
            confirmLabel="Delete rate"
            reasonRequired
            hidden={{ id: rateId }}
          />
        </>
      )}
      <ConfirmAction
        action={endStatutoryRateAction}
        csrfToken={csrfToken}
        label="End"
        title="End this statutory rate"
        description="Sets an expiry date rather than deleting the row — its history stays intact."
        confirmLabel="End rate"
        reasonRequired
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
    </div>
  );
}
