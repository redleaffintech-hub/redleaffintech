"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { COMPANY_ROLES, ROLE_LABELS, type CompanyRole } from "@/lib/enums";
import {
  inviteUserAction,
  removeMembershipAction,
  setMembershipRoleAction,
  setMembershipStatusAction,
} from "../actions";

export function InviteUserForm({ seatsLeft }: { seatsLeft: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="Give someone access" subtitle={seatsLeft > 0 ? `${seatsLeft} seats left` : "No seats left"} />
      <form
        action={async (formData) => {
          setError(null);
          const email = String(formData.get("email") ?? "");
          const result = await inviteUserAction(formData);
          if (result?.error) setError(result.error);
          else {
            setInvited(email);
            router.refresh();
          }
        }}
        className="mt-3 space-y-3"
      >
        <Field label="Name" required>
          <input name="name" className={inputClass} placeholder="Jordan Lee" required />
        </Field>
        <Field label="Email" required>
          <input name="email" type="email" className={inputClass} placeholder="jordan@example.ca" required />
        </Field>
        <Field label="Role" required>
          <select name="role" className={clsx(inputClass, "pr-8")} defaultValue="SECONDARY">
            {COMPANY_ROLES.map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
        </Field>
        <Field
          label="Temporary password"
          required
          hint="This build sends no email — hand this over directly and have them change it."
        >
          <input name="temporaryPassword" type="text" minLength={8} className={inputClass} required />
        </Field>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        {invited && (
          <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">
            {invited} can now sign in. Their membership stays &ldquo;invited&rdquo; until you activate it.
          </p>
        )}

        <Button type="submit" variant="primary" className="w-full" disabled={seatsLeft <= 0}>
          Grant access
        </Button>
      </form>
    </Card>
  );
}

export function MembershipActions({
  membershipId,
  role,
  status,
  name,
  isSelf,
}: {
  membershipId: string;
  role: string;
  status: string;
  name: string;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function run(action: () => Promise<{ error?: string } | void>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) setError(result.error);
      else {
        setConfirmRemove(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <select
        value={role}
        disabled={pending}
        onChange={(event) => run(() => setMembershipRoleAction(membershipId, event.target.value))}
        aria-label={`Role for ${name}`}
        className={clsx(inputClass, "w-full pr-7 text-[0.75rem]")}
      >
        {COMPANY_ROLES.map((option) => (
          <option key={option} value={option}>{ROLE_LABELS[option as CompanyRole]}</option>
        ))}
      </select>

      {!isSelf && (
        <div className="flex items-center gap-2 text-[0.75rem]">
          {status === "ACTIVE" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setMembershipStatusAction(membershipId, "SUSPENDED"))}
              className="text-muted-ink hover:text-negative hover:underline"
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setMembershipStatusAction(membershipId, "ACTIVE"))}
              className="text-muted-ink hover:text-positive hover:underline"
            >
              {status === "INVITED" ? "Activate" : "Restore"}
            </button>
          )}

          {confirmRemove ? (
            <>
              <span className="text-muted-ink">Sure?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => removeMembershipAction(membershipId))}
                className="font-medium text-negative hover:underline"
              >
                Remove
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="text-muted-ink hover:underline">
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="text-muted-ink hover:text-negative hover:underline"
            >
              Remove
            </button>
          )}
        </div>
      )}

      {error && <span className="text-[0.75rem] leading-4 text-negative">{error}</span>}
    </div>
  );
}
