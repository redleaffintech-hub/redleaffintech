"use client";

import { ConfirmAction } from "@/components/admin/forms";
import { approveSeatRequestAction, rejectSeatRequestAction } from "./actions";

export function SeatRequestRowActions({
  csrfToken, requestId, companyName, extraUsers, chargeLabel,
}: {
  csrfToken: string;
  requestId: string;
  companyName: string;
  extraUsers: number;
  chargeLabel: string;
}) {
  const users = `${extraUsers} additional user${extraUsers === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <ConfirmAction
        action={approveSeatRequestAction}
        csrfToken={csrfToken}
        label="Approve"
        tone="primary"
        title={`Approve ${users} for ${companyName}`}
        description={`Raises ${companyName}'s user limit by ${extraUsers} and adds ${chargeLabel} to their billing. The company can add the users straight away.`}
        confirmLabel="Approve"
        hidden={{ id: requestId }}
      />
      <ConfirmAction
        action={rejectSeatRequestAction}
        csrfToken={csrfToken}
        label="Reject"
        title={`Reject ${users} for ${companyName}`}
        description="The company is notified and shown your reason. Their limit does not change."
        confirmLabel="Reject request"
        reasonRequired
        reasonLabel="Reason (shown to the company)"
        hidden={{ id: requestId }}
      />
    </div>
  );
}
