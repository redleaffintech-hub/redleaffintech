"use client";

import Link from "next/link";
import {
  AdminField,
  AdminForm,
  adminInputClass,
  ConfirmAction,
  SubmitButton,
} from "@/components/admin/forms";
import { AdminCard, OverrideTag } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { ROLE_LABELS, type CompanyRole } from "@/lib/enums";
import {
  changeRoleAction,
  grantAccessAction,
  removeAccessAction,
  setAccessStatusAction,
} from "../actions";

export interface MembershipView {
  id: string;
  role: string;
  status: string;
  userId: string;
  userName: string;
  userEmail: string;
  lastLoginAt: string | null;
  isOnlyActivePrimary: boolean;
}

const ROLE_ORDER: CompanyRole[] = ["PRIMARY", "SECONDARY", "REVIEWER", "ACCOUNTANT"];

/**
 * Who can get into this company file, and as what.
 *
 * This panel writes `CompanyUser` rows — the same records the accounting app
 * reads for authorisation. There is no separate, privileged back door: a
 * platform administrator grants access by making the customer's own membership
 * record say so, which is why the change shows up in the client's audit log too.
 *
 * The last active PRIMARY is protected in the service layer, not here; the
 * disabled buttons below are a courtesy that explains why, before the operator
 * has to read an error.
 */
export function AccessPanel({
  csrfToken,
  companyId,
  companyName,
  memberships,
  seatsUsed,
  seatsAllowed,
  seatsOverridden,
  seatOverrideReason,
}: {
  csrfToken: string;
  companyId: string;
  companyName: string;
  memberships: MembershipView[];
  seatsUsed: number;
  seatsAllowed: number | null;
  seatsOverridden: boolean;
  seatOverrideReason: string | null;
}) {
  const atLimit = seatsAllowed !== null && seatsUsed >= seatsAllowed;

  return (
    <AdminCard
      title="Access"
      subtitle="Memberships of this company file"
      actions={
        <span className="flex items-center gap-2 text-[0.75rem] text-muted-ink">
          <span className="tabular-nums">
            {seatsUsed} of {seatsAllowed ?? "—"} seats used
          </span>
          {seatsOverridden && <OverrideTag reason={seatOverrideReason} />}
        </span>
      }
    >
      <ul className="divide-y divide-paper-200">
        {memberships.length === 0 && (
          <li className="py-6 text-center text-[0.8125rem] text-negative">
            Nobody has access to this company. It needs at least one primary user.
          </li>
        )}

        {memberships.map((member) => (
          <li key={member.id} className="space-y-2.5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/admin/users/${member.userId}`}
                  className="text-[0.875rem] font-medium text-ink-900 hover:text-brand-700 hover:underline"
                >
                  {member.userName}
                </Link>
                <p className="text-[0.75rem] text-muted-ink">
                  {member.userEmail}
                  {member.lastLoginAt ? ` · last in ${member.lastLoginAt}` : " · never signed in"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={member.status === "ACTIVE" ? "positive" : member.status === "INVITED" ? "info" : "negative"}>
                  {member.status.toLowerCase()}
                </Badge>
                {member.isOnlyActivePrimary && <Badge tone="caution">only primary</Badge>}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <AdminForm action={changeRoleAction} csrfToken={csrfToken} className="flex items-center gap-2">
                <input type="hidden" name="membershipId" value={member.id} />
                <input type="hidden" name="companyId" value={companyId} />
                <select
                  name="role"
                  defaultValue={member.role}
                  aria-label={`Role for ${member.userEmail}`}
                  className={`${adminInputClass} h-8 w-[10.5rem] text-[0.75rem]`}
                >
                  {ROLE_ORDER.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <SubmitButton tone="secondary" className="h-8">
                  Change role
                </SubmitButton>
              </AdminForm>

              {member.status === "SUSPENDED" ? (
                <AdminForm action={setAccessStatusAction} csrfToken={csrfToken} className="inline-block">
                  <input type="hidden" name="membershipId" value={member.id} />
                  <input type="hidden" name="companyId" value={companyId} />
                  <input type="hidden" name="status" value="ACTIVE" />
                  <SubmitButton tone="secondary" className="h-8">
                    Reactivate
                  </SubmitButton>
                </AdminForm>
              ) : (
                <ConfirmAction
                  action={setAccessStatusAction}
                  csrfToken={csrfToken}
                  label="Suspend"
                  title="Suspend this person's access?"
                  description={
                    <>
                      <strong>{member.userName}</strong> ({member.userEmail}) will lose access to{" "}
                      <strong>{companyName}</strong> immediately. Their work stays in the books.
                    </>
                  }
                  confirmLabel="Suspend access"
                  reasonRequired
                  hidden={{ membershipId: member.id, companyId, status: "SUSPENDED" }}
                  disabled={member.isOnlyActivePrimary}
                  disabledReason="This is the company's only active primary user. Assign another one first."
                />
              )}

              <ConfirmAction
                action={removeAccessAction}
                csrfToken={csrfToken}
                label="Remove"
                title="Remove this person from the company?"
                description={
                  <>
                    <strong>{member.userName}</strong> ({member.userEmail}) will be removed from{" "}
                    <strong>{companyName}</strong>. Their account and everything they posted remain; only the
                    membership goes.
                  </>
                }
                confirmLabel="Remove access"
                reasonRequired
                hidden={{ membershipId: member.id, companyId }}
                disabled={member.isOnlyActivePrimary}
                disabledReason="This is the company's only active primary user. Assign another one first."
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-paper-200 pt-4">
        <p className="mb-2.5 text-[0.8125rem] font-medium text-ink-900">Grant access</p>
        <AdminForm action={grantAccessAction} csrfToken={csrfToken}>
          <input type="hidden" name="companyId" value={companyId} />
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
            <AdminField label="User email" required htmlFor="grant-email">
              <input
                id="grant-email"
                name="userEmail"
                type="email"
                required
                className={adminInputClass}
                placeholder="someone@company.ca"
              />
            </AdminField>
            <AdminField label="Role" required htmlFor="grant-role">
              <select id="grant-role" name="role" defaultValue="SECONDARY" required className={adminInputClass}>
                {ROLE_ORDER.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </AdminField>
            <div className="flex items-end">
              <SubmitButton disabled={atLimit}>Grant access</SubmitButton>
            </div>
          </div>
        </AdminForm>
        <p className="mt-2 text-[0.75rem] leading-5 text-muted-ink">
          {atLimit ? (
            <span className="text-caution">
              Every seat on this subscription is in use. Raise the seat allowance before adding anyone else.
            </span>
          ) : (
            <>
              The person must already have an account.{" "}
              <Link href="/admin/users/new" className="font-medium text-brand-700 hover:underline">
                Create a user
              </Link>{" "}
              if they do not.
            </>
          )}
        </p>
      </div>
    </AdminCard>
  );
}
