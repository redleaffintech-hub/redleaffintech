"use client";

import { ConfirmAction } from "@/components/admin/forms";
import { StepUpFields } from "@/components/admin/step-up";
import {
  promoteExistingUserAction,
  removeAdministratorAction,
  suspendAdministratorAction,
} from "./actions";

/**
 * Per-row controls in the administrator table.
 *
 * The disabled states here mirror the two invariants the service layer enforces
 * — nobody removes their own last access, and one active administrator always
 * remains — so an operator learns why *before* they compose a reason and hit
 * confirm. The refusal itself still happens on the server, inside the
 * transaction, where a race cannot slip past it.
 */
export function AdministratorRowActions({
  csrfToken,
  userId,
  userName,
  userEmail,
  isSuspended,
  isSelf,
  isLastActive,
  actorMfaEnabled,
  actorRecentlyVerified,
  stepUpWindowMinutes,
}: {
  csrfToken: string;
  userId: string;
  userName: string;
  userEmail: string;
  isSuspended: boolean;
  isSelf: boolean;
  isLastActive: boolean;
  actorMfaEnabled: boolean;
  actorRecentlyVerified: boolean;
  stepUpWindowMinutes: number;
}) {
  const stepUp = (
    <StepUpFields
      mfaEnabled={actorMfaEnabled}
      recentlyVerified={actorRecentlyVerified}
      windowMinutes={stepUpWindowMinutes}
    />
  );

  const blocked = isSelf
    ? "You cannot change your own platform access."
    : isLastActive
      ? "This is the last active platform administrator. Appoint another one first."
      : undefined;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {isSuspended ? (
        <ConfirmAction
          action={promoteExistingUserAction}
          csrfToken={csrfToken}
          label="Reinstate"
          tone="secondary"
          title="Reinstate this administrator?"
          description={
            <>
              <strong>{userName}</strong> ({userEmail}) will be able to sign in to the console again.
            </>
          }
          confirmLabel="Reinstate"
          reasonRequired
          hidden={{ userId }}
          extraFields={stepUp}
        />
      ) : (
        <ConfirmAction
          action={suspendAdministratorAction}
          csrfToken={csrfToken}
          label="Suspend"
          title="Suspend this administrator?"
          description={
            <>
              <strong>{userName}</strong> loses the console immediately, including any open session. Their user
              account and client access are untouched. Reversible.
            </>
          }
          confirmLabel="Suspend"
          reasonRequired
          hidden={{ userId }}
          extraFields={stepUp}
          disabled={Boolean(blocked)}
          disabledReason={blocked}
        />
      )}

      <ConfirmAction
        action={removeAdministratorAction}
        csrfToken={csrfToken}
        label="Remove"
        title="Remove platform administrator access?"
        description={
          <>
            <strong>{userName}</strong> ({userEmail}) stops being a platform administrator. Their account, company
            memberships and MFA enrolment all remain.
          </>
        }
        confirmLabel="Remove access"
        reasonRequired
        hidden={{ userId }}
        extraFields={stepUp}
        disabled={isSelf}
        disabledReason={isSelf ? "You cannot remove your own platform access." : undefined}
      />
    </div>
  );
}
