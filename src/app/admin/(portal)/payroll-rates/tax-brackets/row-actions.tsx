"use client";

import Link from "next/link";
import { ConfirmAction } from "@/components/admin/forms";
import { deleteBracketAction, endBracketAction } from "./actions";

export function BracketRowActions({
  csrfToken,
  bracketId,
  isFuture,
}: {
  csrfToken: string;
  bracketId: string;
  isFuture: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {isFuture && (
        <>
          <Link
            href={`/admin/payroll-rates/tax-brackets/${bracketId}/edit`}
            className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
          >
            Edit
          </Link>
          <ConfirmAction
            action={deleteBracketAction}
            csrfToken={csrfToken}
            label="Delete"
            title="Delete this future bracket"
            description="Permanent — this bracket has never taken effect. Choose End instead for one already in force."
            confirmLabel="Delete bracket"
            reasonRequired
            hidden={{ id: bracketId }}
          />
        </>
      )}
      <ConfirmAction
        action={endBracketAction}
        csrfToken={csrfToken}
        label="End"
        title="End this bracket"
        description="Sets an expiry date rather than deleting the row — its history stays intact."
        confirmLabel="End bracket"
        reasonRequired
        hidden={{ id: bracketId }}
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
