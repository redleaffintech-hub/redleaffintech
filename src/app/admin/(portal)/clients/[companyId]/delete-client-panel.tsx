"use client";

import { useState } from "react";
import { AdminField, AdminForm, adminInputClass, SubmitButton } from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { deleteClientAction } from "../actions";

/**
 * The one truly irreversible action on this screen. Every Company-scoped
 * table cascades from the delete (checked against the schema — nothing is
 * left orphaned or half-removed), so this takes the whole client with it:
 * every invoice, journal entry, membership and audit-log row. Only the
 * `User` accounts of anyone who had access survive, since a login can belong
 * to other companies too.
 */
export function DeleteClientPanel({
  csrfToken,
  companyId,
  companyName,
}: {
  csrfToken: string;
  companyId: string;
  companyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const matches = confirmName.trim() === companyName;

  return (
    <AdminCard title="Delete this client" subtitle="Permanent. There is no undo.">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 items-center rounded-lg border border-[color:var(--color-negative)]/30 bg-white px-3.5 text-[0.8125rem] font-medium text-negative hover:bg-negative-soft"
        >
          Delete client
        </button>
      ) : (
        <div className="rounded-lg border border-[color:var(--color-negative)]/35 bg-negative-soft/50 p-4">
          <p className="text-[0.875rem] font-semibold text-ink-900">
            Permanently delete {companyName}?
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-6 text-ink-700">
            Every invoice, bill, journal entry, bank account, tax filing and audit-log row belonging to this company
            is deleted along with it. Anyone with access loses it immediately; their own login is unaffected. This
            cannot be undone and nothing is archived.
          </p>

          <AdminForm
            action={deleteClientAction}
            csrfToken={csrfToken}
            className="mt-3"
            onSuccess={() => {
              setOpen(false);
              setConfirmName("");
            }}
          >
            <input type="hidden" name="companyId" value={companyId} />
            <div className="mb-3">
              <AdminField
                label={`Type "${companyName}" to confirm`}
                required
                htmlFor="confirm-delete-name"
              >
                <input
                  id="confirm-delete-name"
                  name="confirmName"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                  autoComplete="off"
                  className={adminInputClass}
                  placeholder={companyName}
                />
              </AdminField>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton tone="danger" disabled={!matches} pendingLabel="Deleting…">
                Delete permanently
              </SubmitButton>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirmName("");
                }}
                className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
              >
                Cancel
              </button>
            </div>
          </AdminForm>
        </div>
      )}
    </AdminCard>
  );
}
