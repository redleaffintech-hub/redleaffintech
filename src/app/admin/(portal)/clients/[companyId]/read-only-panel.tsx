"use client";

import { ConfirmAction } from "@/components/admin/forms";
import { setClientReadOnlyAction } from "../actions";

/**
 * The manual read-only lever.
 *
 * Distinct from suspension: suspension is a *subscription* state and sets this
 * flag itself. This is for the cases that have nothing to do with billing — a
 * file frozen during a dispute, or at the client's own request. That is why the
 * control says so plainly when the subscription is already holding the flag
 * down: releasing it here would be undone by the next lifecycle change, and an
 * operator should know that before they try.
 */
export function ReadOnlyPanel({
  csrfToken,
  companyId,
  companyName,
  isReadOnly,
  lockedBySubscription,
}: {
  csrfToken: string;
  companyId: string;
  companyName: string;
  isReadOnly: boolean;
  lockedBySubscription: boolean;
}) {
  return (
    <div>
      <p className="text-[0.8125rem] leading-6 text-ink-800">
        {isReadOnly ? (
          <>
            <strong>{companyName}</strong> is read-only. Everyone with access can still read, report and export;
            nothing new can be posted to the ledger.
          </>
        ) : (
          <>
            <strong>{companyName}</strong> is writable. Making it read-only stops new postings immediately, without
            touching anything already recorded.
          </>
        )}
      </p>

      {lockedBySubscription && (
        <p className="mt-2 rounded-md border border-[color:var(--color-caution)]/30 bg-caution-soft px-3 py-2 text-[0.75rem] leading-5 text-ink-800">
          This file is currently read-only because of its subscription state. Releasing it here is temporary — the
          next subscription change will reapply it. Restore the subscription instead.
        </p>
      )}

      <div className="mt-3">
        {isReadOnly ? (
          <ConfirmAction
            action={setClientReadOnlyAction}
            csrfToken={csrfToken}
            label="Make writable"
            tone="secondary"
            title="Allow postings again?"
            description={
              <>
                <strong>{companyName}</strong> will be able to post to its ledger again.
              </>
            }
            confirmLabel="Make writable"
            reasonRequired
            hidden={{ companyId, isReadOnly: "false" }}
          />
        ) : (
          <ConfirmAction
            action={setClientReadOnlyAction}
            csrfToken={csrfToken}
            label="Make read-only"
            title="Freeze this company's books?"
            description={
              <>
                <strong>{companyName}</strong> will be unable to post invoices, bills, expenses, payments or journals.
                Reading, reporting and exporting are unaffected, and nothing already posted is changed.
              </>
            }
            confirmLabel="Make read-only"
            reasonRequired
            hidden={{ companyId, isReadOnly: "true" }}
          />
        )}
      </div>
    </div>
  );
}
