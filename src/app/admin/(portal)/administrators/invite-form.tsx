"use client";

import Link from "next/link";
import { AdminField, AdminForm, adminInputClass, adminTextareaClass, SubmitButton } from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { StepUpFields } from "@/components/admin/step-up";
import { promoteAdministratorAction } from "./actions";

/**
 * Appointing a new platform administrator.
 *
 * Deliberately a *promotion* of an existing account rather than a fresh
 * invitation with its own credential. Making somebody an administrator and
 * creating their login are two different decisions, and folding them into one
 * form is how an unverified email address ends up holding the keys to every
 * client on the platform.
 */
export function InviteAdministratorForm({
  csrfToken,
  actorMfaEnabled,
  actorRecentlyVerified,
  stepUpWindowMinutes,
}: {
  csrfToken: string;
  actorMfaEnabled: boolean;
  actorRecentlyVerified: boolean;
  stepUpWindowMinutes: number;
}) {
  return (
    <AdminCard
      title="Appoint an administrator"
      subtitle="Grants console access to an account that already exists"
    >
      <AdminForm action={promoteAdministratorAction} csrfToken={csrfToken}>
        <div className="space-y-4">
          <AdminField
            label="Their email"
            required
            htmlFor="promote-email"
            hint="They must already have a Red Leaf account."
          >
            <input
              id="promote-email"
              name="email"
              type="email"
              required
              className={adminInputClass}
              placeholder="colleague@redleaffintech.com"
            />
          </AdminField>

          <AdminField label="Why do they need it?" required htmlFor="promote-reason">
            <textarea
              id="promote-reason"
              name="reason"
              rows={2}
              required
              className={adminTextareaClass}
              placeholder="e.g. Joining the support team; needs to manage client subscriptions."
            />
          </AdminField>

          <div className="border-t border-paper-200 pt-4">
            <StepUpFields
              mfaEnabled={actorMfaEnabled}
              recentlyVerified={actorRecentlyVerified}
              windowMinutes={stepUpWindowMinutes}
            />
            <SubmitButton pendingLabel="Granting…">Grant platform access</SubmitButton>
          </div>
        </div>
      </AdminForm>

      <p className="mt-4 border-t border-paper-200 pt-3 text-[0.75rem] leading-5 text-muted-ink">
        No account yet?{" "}
        <Link href="/admin/users/new" className="font-medium text-brand-700 hover:underline">
          Create the user first
        </Link>
        , let them set their own password, then appoint them here.
      </p>
    </AdminCard>
  );
}
