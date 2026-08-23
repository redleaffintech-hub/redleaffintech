"use client";

import Link from "next/link";
import { AdminForm, ConfirmAction, SubmitButton } from "@/components/admin/forms";
import {
  archivePlanAction,
  deletePlanAction,
  publishPlanAction,
  reactivatePlanAction,
  setVisibilityAction,
} from "./actions";

/**
 * Per-plan controls.
 *
 * Publish is a plain button because it is not destructive — it makes the working
 * copy visible and nothing else. Archive and delete are confirmed, and delete
 * only appears at all for a draft nothing points at: a plan a subscription
 * references is archived instead, because deleting it would take that customer's
 * agreed price with it.
 */
export function PlanRowActions({
  csrfToken,
  planId,
  planName,
  planCode,
  status,
  isPublic,
  isArchived,
  hasDraftChanges,
  subscriptionCount,
}: {
  csrfToken: string;
  planId: string;
  planName: string;
  planCode: string;
  status: string;
  isPublic: boolean;
  isArchived: boolean;
  hasDraftChanges: boolean;
  subscriptionCount: number;
}) {
  const neverPublished = status === "DRAFT";
  const deletable = neverPublished && subscriptionCount === 0;

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Link
        href={`/admin/plans/${planId}/edit`}
        className="inline-flex h-8 items-center rounded-lg border border-paper-400 bg-white px-2.5 text-[0.75rem] font-medium text-ink-800 hover:bg-paper-100"
      >
        Edit
      </Link>

      {!isArchived && (hasDraftChanges || neverPublished) && (
        <AdminForm action={publishPlanAction} csrfToken={csrfToken} className="inline-block">
          <input type="hidden" name="planId" value={planId} />
          <SubmitButton className="h-8 px-2.5 text-[0.75rem]" pendingLabel="Publishing…">
            Publish
          </SubmitButton>
        </AdminForm>
      )}

      {!isArchived && status === "PUBLISHED" && (
        <AdminForm action={setVisibilityAction} csrfToken={csrfToken} className="inline-block">
          <input type="hidden" name="planId" value={planId} />
          <input type="hidden" name="isPublic" value={isPublic ? "false" : "true"} />
          <SubmitButton tone="secondary" className="h-8 px-2.5 text-[0.75rem]">
            {isPublic ? "Hide" : "Show"}
          </SubmitButton>
        </AdminForm>
      )}

      {isArchived ? (
        <AdminForm action={reactivatePlanAction} csrfToken={csrfToken} className="inline-block">
          <input type="hidden" name="planId" value={planId} />
          <SubmitButton tone="secondary" className="h-8 px-2.5 text-[0.75rem]">
            Reactivate
          </SubmitButton>
        </AdminForm>
      ) : (
        <ConfirmAction
          action={archivePlanAction}
          csrfToken={csrfToken}
          label="Archive"
          title={`Withdraw ${planName} from sale?`}
          description={
            <>
              <strong>{planName}</strong> ({planCode}) disappears from the public pricing page and can no longer be
              assigned.{" "}
              {subscriptionCount > 0
                ? `The ${subscriptionCount} subscription${
                    subscriptionCount === 1 ? "" : "s"
                  } already on it keep their agreed price and continue working.`
                : "Nothing is currently on it."}
            </>
          }
          confirmLabel="Archive plan"
          reasonRequired
          hidden={{ planId }}
        />
      )}

      {deletable && (
        <ConfirmAction
          action={deletePlanAction}
          csrfToken={csrfToken}
          label="Delete"
          title={`Delete the draft ${planName}?`}
          description={
            <>
              This plan has never been published and nothing references it, so it can be removed outright. This cannot
              be undone.
            </>
          }
          confirmLabel="Delete draft"
          hidden={{ planId }}
        />
      )}
    </div>
  );
}
