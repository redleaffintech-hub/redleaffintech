"use client";

import Link from "next/link";
import {
  AdminField,
  AdminForm,
  adminInputClass,
  ConfirmAction,
  SubmitButton,
} from "@/components/admin/forms";
import { AdminCard, SubscriptionStatusBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui";
import { ROLE_LABELS, type CompanyRole } from "@/lib/enums";
import {
  changeUserRoleAction,
  grantMembershipFromUserAction,
  removeUserMembershipAction,
  setUserMembershipStatusAction,
} from "../actions";

export interface UserMembershipView {
  id: string;
  role: string;
  status: string;
  companyId: string;
  companyName: string;
  subscriptionStatus: string | null;
  plan: string | null;
  isOnlyActivePrimary: boolean;
}

const ROLE_ORDER: CompanyRole[] = ["PRIMARY", "SECONDARY", "REVIEWER", "ACCOUNTANT"];

/**
 * The companies this person belongs to, and their standing in each.
 *
 * One account, many books — the same person can be PRIMARY of their own company
 * and ACCOUNTANT on a client's, and the role is a property of the membership,
 * never of the user. That is the whole reason this is a list rather than a
 * single "role" field on the account.
 */
export function UserMemberships({
  csrfToken,
  userId,
  memberships,
}: {
  csrfToken: string;
  userId: string;
  memberships: UserMembershipView[];
}) {
  return (
    <AdminCard title="Company access" subtitle="Where this person can sign in, and as what">
      <ul className="divide-y divide-paper-200">
        {memberships.length === 0 && (
          <li className="py-6 text-center text-[0.8125rem] text-muted-ink">
            This account belongs to no company yet, so signing in leads nowhere. Grant access below.
          </li>
        )}

        {memberships.map((membership) => (
          <li key={membership.id} className="space-y-2.5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/admin/clients/${membership.companyId}`}
                  className="text-[0.875rem] font-medium text-ink-900 hover:text-brand-700 hover:underline"
                >
                  {membership.companyName}
                </Link>
                <p className="text-[0.75rem] text-muted-ink">
                  {ROLE_LABELS[membership.role as CompanyRole] ?? membership.role}
                  {membership.plan ? ` · ${membership.plan}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    membership.status === "ACTIVE" ? "positive" : membership.status === "INVITED" ? "info" : "negative"
                  }
                >
                  {membership.status.toLowerCase()}
                </Badge>
                {membership.subscriptionStatus && (
                  <SubscriptionStatusBadge status={membership.subscriptionStatus} />
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <AdminForm action={changeUserRoleAction} csrfToken={csrfToken} className="flex items-center gap-2">
                <input type="hidden" name="membershipId" value={membership.id} />
                <input type="hidden" name="userId" value={userId} />
                <select
                  name="role"
                  defaultValue={membership.role}
                  aria-label={`Role in ${membership.companyName}`}
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

              {membership.status === "SUSPENDED" ? (
                <AdminForm action={setUserMembershipStatusAction} csrfToken={csrfToken} className="inline-block">
                  <input type="hidden" name="membershipId" value={membership.id} />
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="status" value="ACTIVE" />
                  <SubmitButton tone="secondary" className="h-8">
                    Reactivate
                  </SubmitButton>
                </AdminForm>
              ) : (
                <ConfirmAction
                  action={setUserMembershipStatusAction}
                  csrfToken={csrfToken}
                  label="Suspend"
                  title="Suspend access to this company?"
                  description={
                    <>
                      They will lose access to <strong>{membership.companyName}</strong> immediately. Their account and
                      their other companies are unaffected.
                    </>
                  }
                  confirmLabel="Suspend access"
                  reasonRequired
                  hidden={{ membershipId: membership.id, userId, status: "SUSPENDED" }}
                  disabled={membership.isOnlyActivePrimary}
                  disabledReason={`They are the only active primary user of ${membership.companyName}.`}
                />
              )}

              <ConfirmAction
                action={removeUserMembershipAction}
                csrfToken={csrfToken}
                label="Remove"
                title="Remove them from this company?"
                description={
                  <>
                    The membership with <strong>{membership.companyName}</strong> is deleted. Everything they posted
                    stays in the books, and their account remains.
                  </>
                }
                confirmLabel="Remove access"
                reasonRequired
                hidden={{ membershipId: membership.id, userId }}
                disabled={membership.isOnlyActivePrimary}
                disabledReason={`They are the only active primary user of ${membership.companyName}.`}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-paper-200 pt-4">
        <p className="mb-2.5 text-[0.8125rem] font-medium text-ink-900">Add to a company</p>
        <AdminForm action={grantMembershipFromUserAction} csrfToken={csrfToken}>
          <input type="hidden" name="userId" value={userId} />
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
            <AdminField label="Company name" required htmlFor="grant-company">
              <input
                id="grant-company"
                name="companyName"
                required
                className={adminInputClass}
                placeholder="Northbridge Consulting"
              />
            </AdminField>
            <AdminField label="Role" required htmlFor="grant-user-role">
              <select id="grant-user-role" name="role" defaultValue="SECONDARY" required className={adminInputClass}>
                {ROLE_ORDER.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </AdminField>
            <div className="flex items-end">
              <SubmitButton>Grant access</SubmitButton>
            </div>
          </div>
        </AdminForm>
        <p className="mt-2 text-[0.75rem] leading-5 text-muted-ink">
          The name must match exactly. If two companies share a name, grant access from the client&rsquo;s own page
          instead — this form refuses to guess which one you meant.
        </p>
      </div>
    </AdminCard>
  );
}
