import { requirePasswordChangeActor } from "@/server/admin/guard";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { AdminField, AdminForm, adminInputClass, SubmitButton } from "@/components/admin/forms";
import { changeOwnPasswordAction } from "./actions";

export const metadata = { title: "Set a new password" };

/**
 * The only screen a `mustChangePassword` administrator may reach.
 *
 * It sits outside the `(portal)` group deliberately: its guard is the one that
 * tolerates the flag, and putting it inside would mean the portal layout's guard
 * redirected the operator here from here, forever.
 */
export default async function ChangePasswordPage() {
  const actor = await requirePasswordChangeActor();

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-[26rem]">
        <div className="rounded-(--radius-card) border border-ink-800 bg-white p-6 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]">
          <h1 className="font-display text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">
            Set a new password
          </h1>
          <p className="mt-1.5 text-[0.8125rem] leading-6 text-muted-ink">
            {actor.mustChangePassword
              ? "Your password was issued by an administrator, so it has to be replaced before you can go any further."
              : "Choose a new password for your platform administrator account."}
          </p>

          <AdminForm action={changeOwnPasswordAction} csrfToken={actor.csrfToken} className="mt-6 space-y-4">
            <input type="hidden" name="email" value={actor.email} autoComplete="username" readOnly />

            <AdminField label="Current password" required htmlFor="current-password">
              <input
                id="current-password"
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                className={adminInputClass}
              />
            </AdminField>

            <AdminField
              label="New password"
              required
              htmlFor="new-password"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters, mixing at least three of: lower case, upper case, digits, symbols.`}
            >
              <input
                id="new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                className={adminInputClass}
              />
            </AdminField>

            <AdminField label="Confirm new password" required htmlFor="confirm-password">
              <input
                id="confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                className={adminInputClass}
              />
            </AdminField>

            <SubmitButton className="w-full" pendingLabel="Saving…">
              Save and continue
            </SubmitButton>

            <p className="text-[0.75rem] leading-5 text-muted-ink">
              Saving signs you out everywhere else and starts a fresh session here.
            </p>
          </AdminForm>
        </div>
      </div>
    </div>
  );
}
