"use client";

import { AdminField, AdminForm, adminInputClass, SubmitButton } from "@/components/admin/forms";
import { AdminCard } from "@/components/admin/ui";
import { updateUserAction } from "../actions";

/**
 * Name and email.
 *
 * Changing the email changes the login identifier, which is why the hint says so
 * out loud — a support agent "tidying up a typo" can otherwise lock someone out
 * of their own account without realising it.
 */
export function ProfileForm({
  csrfToken,
  userId,
  name,
  email,
}: {
  csrfToken: string;
  userId: string;
  name: string;
  email: string;
}) {
  return (
    <AdminCard title="Details">
      <AdminForm action={updateUserAction} csrfToken={csrfToken}>
        <input type="hidden" name="userId" value={userId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField label="Full name" required htmlFor="profile-name">
            <input id="profile-name" name="name" required defaultValue={name} className={adminInputClass} />
          </AdminField>
          <AdminField
            label="Email"
            required
            htmlFor="profile-email"
            hint="This is how they sign in. Changing it changes their login."
          >
            <input
              id="profile-email"
              name="email"
              type="email"
              required
              defaultValue={email}
              className={adminInputClass}
            />
          </AdminField>
        </div>
        <div className="mt-4">
          <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
        </div>
      </AdminForm>
    </AdminCard>
  );
}
