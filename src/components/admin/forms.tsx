"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import { CSRF_FIELD } from "@/lib/admin-constants";

/**
 * Form plumbing for the admin portal.
 *
 * Three things every mutation in this portal gets for free, because forgetting
 * any one of them on a console that can suspend a business is not an option:
 *
 *   * the CSRF token, injected on submit rather than left to each form to
 *     remember;
 *   * a disabled submit button while the request is in flight, so a double
 *     click cannot cancel a subscription twice;
 *   * a visible error, rendered from the action's `{ error }` result instead of
 *     thrown into a boundary the operator will read as "something broke".
 */

export type ActionResult = { ok?: boolean; error?: string; message?: string } | void | undefined;
export type AdminAction = (formData: FormData) => Promise<ActionResult>;

export function AdminForm({
  action,
  csrfToken,
  children,
  className,
  onSuccess,
}: {
  action: AdminAction;
  csrfToken: string;
  children: ReactNode;
  className?: string;
  /** Called after a successful submit — used to clear a panel or reset fields. */
  onSuccess?: (message?: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handle(formData: FormData) {
    setError(null);
    setMessage(null);
    formData.set(CSRF_FIELD, csrfToken);
    const result = await action(formData);
    if (result?.error) {
      setError(result.error);
      return;
    }
    if (result?.message) setMessage(result.message);
    onSuccess?.(result?.message);
  }

  return (
    <form ref={formRef} action={handle} className={className}>
      {children}
      {error && <FormError>{error}</FormError>}
      {message && (
        <p className="mt-3 rounded-md border border-[color:var(--color-positive)]/25 bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">
          {message}
        </p>
      )}
    </form>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] leading-6 text-negative"
    >
      {children}
    </p>
  );
}

const SUBMIT_TONES = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-400",
  danger: "bg-negative text-white hover:bg-maple-700 disabled:bg-maple-400",
  secondary: "border border-paper-400 bg-white text-ink-800 hover:bg-paper-100 disabled:text-ink-400",
} as const;

export function SubmitButton({
  children,
  tone = "primary",
  pendingLabel,
  className,
  disabled,
}: {
  children: ReactNode;
  tone?: keyof typeof SUBMIT_TONES;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      // Disabled while pending is the entire duplicate-submission defence on the
      // client. The server still has to be idempotent or guarded; this only
      // stops the honest accident.
      disabled={pending || disabled}
      className={clsx(
        "inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-[0.8125rem] font-medium transition-colors disabled:cursor-not-allowed",
        SUBMIT_TONES[tone],
        className,
      )}
    >
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

export function AdminField({
  label,
  children,
  hint,
  required,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
  htmlFor?: string;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[0.75rem] font-medium text-ink-800"
      >
        {label}
        {required && <span className="ml-0.5 text-negative">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[0.6875rem] leading-5 text-muted-ink">{hint}</p>}
    </div>
  );
}

export const adminInputClass =
  "h-9 w-full rounded-lg border border-paper-400 bg-white px-3 text-[0.8125rem] text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

export const adminTextareaClass =
  "w-full rounded-lg border border-paper-400 bg-white px-3 py-2 text-[0.8125rem] leading-6 text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

/**
 * A single dangerous action behind an explicit confirmation.
 *
 * The confirmation panel states, in words, exactly which company or person is
 * affected — a dialog that says "Are you sure?" and nothing else is a dialog
 * everybody clicks through. Where `reasonRequired` is set the operator cannot
 * confirm until they have typed why, and that reason lands in the audit log.
 */
export function ConfirmAction({
  action,
  csrfToken,
  label,
  title,
  description,
  confirmLabel,
  tone = "danger",
  reasonRequired = false,
  reasonLabel = "Reason",
  reasonHint,
  hidden,
  extraFields,
  disabled,
  disabledReason,
  onSuccess,
}: {
  action: AdminAction;
  csrfToken: string;
  label: string;
  title: string;
  /** What is about to happen, naming the affected entity. */
  description: ReactNode;
  confirmLabel?: string;
  tone?: keyof typeof SUBMIT_TONES;
  reasonRequired?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  hidden?: Record<string, string>;
  extraFields?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Receives the action's success message. The panel closes on success and takes
   * its own message with it, so a caller that needs to *keep* the result — a
   * one-time secret, say — has to be handed it.
   */
  onSuccess?: (message?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reasonId = useId();

  if (disabled) {
    return (
      <span title={disabledReason} className="inline-flex">
        <button
          type="button"
          disabled
          className="inline-flex h-9 cursor-not-allowed items-center rounded-lg border border-paper-300 bg-paper-100 px-3.5 text-[0.8125rem] font-medium text-ink-400"
        >
          {label}
        </button>
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          "inline-flex h-9 items-center rounded-lg px-3.5 text-[0.8125rem] font-medium transition-colors",
          tone === "danger"
            ? "border border-[color:var(--color-negative)]/30 bg-white text-negative hover:bg-negative-soft"
            : "border border-paper-400 bg-white text-ink-800 hover:bg-paper-100",
        )}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[color:var(--color-caution)]/35 bg-caution-soft/60 p-4">
      <p className="text-[0.875rem] font-semibold text-ink-900">{title}</p>
      <div className="mt-1.5 text-[0.8125rem] leading-6 text-ink-700">{description}</div>

      <AdminForm
        action={action}
        csrfToken={csrfToken}
        className="mt-3"
        onSuccess={(message) => {
          setOpen(false);
          setReason("");
          onSuccess?.(message);
        }}
      >
        {hidden &&
          Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
        {extraFields}

        {reasonRequired && (
          <div className="mb-3">
            <label htmlFor={reasonId} className="mb-1 block text-[0.75rem] font-medium text-ink-800">
              {reasonLabel} <span className="text-negative">*</span>
            </label>
            <textarea
              id={reasonId}
              name="reason"
              rows={2}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={adminTextareaClass}
              placeholder="Recorded in the audit log against your name."
            />
            {reasonHint && <p className="mt-1 text-[0.6875rem] leading-5 text-muted-ink">{reasonHint}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton tone={tone} disabled={reasonRequired && reason.trim().length === 0}>
            {confirmLabel ?? label}
          </SubmitButton>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-9 items-center rounded-lg border border-paper-400 bg-white px-3.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
          >
            Cancel
          </button>
        </div>
      </AdminForm>
    </div>
  );
}

/** A mutation with no confirmation — used only where nothing is destroyed. */
export function QuickAction({
  action,
  csrfToken,
  label,
  hidden,
  tone = "secondary",
}: {
  action: AdminAction;
  csrfToken: string;
  label: string;
  hidden?: Record<string, string>;
  tone?: keyof typeof SUBMIT_TONES;
}) {
  return (
    <AdminForm action={action} csrfToken={csrfToken} className="inline-block">
      {hidden &&
        Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <SubmitButton tone={tone}>{label}</SubmitButton>
    </AdminForm>
  );
}
