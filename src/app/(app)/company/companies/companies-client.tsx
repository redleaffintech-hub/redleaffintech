"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Badge, Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { switchCompanyAction } from "@/app/actions/session";
import {
  archiveCompanyAction,
  createCompanyAction,
  deleteCompanyAction,
  restoreCompanyAction,
} from "./actions";

interface Option {
  code: string;
  name: string;
}
interface CreateOptions {
  provinces: Option[];
  currencies: { code: string; label: string }[];
}

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1))),
}));

/**
 * Header actions: the usage badge and the "Add company" dialog.
 *
 * The limit is enforced server-side inside `createCompanyAction` under a row
 * lock — disabling the button here is a convenience, not the control.
 */
export function CompaniesToolbar({
  usage,
  overLimit,
  atLimit,
  planName,
  options,
}: {
  usage: string;
  overLimit: boolean;
  atLimit: boolean;
  planName: string | null;
  options: CreateOptions;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Badge tone={overLimit ? "negative" : atLimit ? "caution" : "neutral"}>{usage}</Badge>
      <Button
        variant="primary"
        disabled={atLimit}
        onClick={() => setOpen(true)}
        title={atLimit ? `The ${planName ?? "current"} plan is fully used. Archive a company or upgrade to add another.` : undefined}
      >
        Add company
      </Button>
      {open && <CreateCompanyDialog options={options} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CreateCompanyDialog({ options, onClose }: { options: CreateOptions; onClose: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <Modal open onClose={onClose} size="lg" title="Add a company">
      <form
        action={async (formData) => {
          if (saving) return; // guard against a double submit
          setSaving(true);
          setError(null);
          const result = await createCompanyAction(formData);
          setSaving(false);
          if (result?.error) {
            setError(result.error);
            return;
          }
          onClose();
          router.refresh();
        }}
        className="space-y-4"
      >
        <p className="text-[0.8125rem] leading-5 text-muted-ink">
          Adds a new company under this same subscription — no separate plan or billing. You are added as its primary
          admin, and the standard chart of accounts, tax codes and fiscal periods are set up automatically.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" required>
            <input name="name" required maxLength={120} className={inputClass} placeholder="Riverside Holdings Inc." />
          </Field>
          <Field label="Legal name" hint="Defaults to the company name.">
            <input name="legalName" maxLength={120} className={inputClass} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Province" required>
            <select name="province" required defaultValue="" className={clsx(inputClass, "pr-8")}>
              <option value="" disabled>Choose…</option>
              {options.provinces.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Base currency" required>
            <select name="baseCurrency" required defaultValue="CAD" className={clsx(inputClass, "pr-8")}>
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Fiscal year starts" required>
            <select name="fiscalYearStartMonth" required defaultValue="1" className={clsx(inputClass, "pr-8")}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-3 border-t border-paper-200 pt-4 sm:grid-cols-2">
          <Field label="Business number (BN)">
            <input name="businessNumber" maxLength={30} className={clsx(inputClass, "tnum")} placeholder="123456789" />
          </Field>
          <Field label="GST/HST number">
            <input name="gstNumber" maxLength={30} className={clsx(inputClass, "tnum")} placeholder="123456789 RT0001" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Email">
            <input name="email" type="email" maxLength={120} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="phone" maxLength={30} className={inputClass} />
          </Field>
          <Field label="Industry">
            <input name="industry" maxLength={80} className={inputClass} />
          </Field>
        </div>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Creating…" : "Add company"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Row actions: switch, archive, restore, delete.
 *
 * `isCurrent` disables archive/delete entirely — the acting user's own active
 * company is never removable from this screen, which is also what guarantees
 * a subscription's family can never reach zero live companies this way.
 */
export function CompanyRowActions({
  company,
  isCurrent,
  isMember,
  archived,
}: {
  company: { id: string; name: string };
  isCurrent: boolean;
  isMember: boolean;
  archived: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"archive" | "delete" | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1">
        {!isCurrent && isMember && !archived && (
          <form
            action={async () => {
              setBusy(true);
              await switchCompanyAction(company.id);
            }}
          >
            <button
              type="submit"
              disabled={busy}
              className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-brand-700 transition-colors hover:bg-brand-soft disabled:opacity-50"
            >
              Open
            </button>
          </form>
        )}
        {archived ? (
          <button
            type="button"
            onClick={() => setDialog("restore")}
            className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
          >
            Restore
          </button>
        ) : (
          !isCurrent && (
            <>
              <button
                type="button"
                onClick={() => setDialog("archive")}
                className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-ink-700 transition-colors hover:bg-paper-200"
              >
                Archive
              </button>
              <button
                type="button"
                onClick={() => setDialog("delete")}
                className="rounded-md px-2 py-1 text-[0.75rem] font-medium text-negative transition-colors hover:bg-negative-soft"
              >
                Delete
              </button>
            </>
          )
        )}
      </span>
      {error && <span className="max-w-[16rem] text-right text-[0.6875rem] text-negative">{error}</span>}

      {dialog === "archive" && (
        <RemovalDialog
          kind="archive"
          company={company}
          onClose={() => setDialog(null)}
          onError={setError}
          onSuccess={() => router.refresh()}
        />
      )}
      {dialog === "delete" && (
        <RemovalDialog
          kind="delete"
          company={company}
          onClose={() => setDialog(null)}
          onError={setError}
          onSuccess={() => router.refresh()}
        />
      )}
      {dialog === "restore" && (
        <RestoreDialog
          company={company}
          onClose={() => setDialog(null)}
          onError={setError}
          onSuccess={() => router.refresh()}
        />
      )}
    </span>
  );
}

function RemovalDialog({
  kind,
  company,
  onClose,
  onError,
  onSuccess,
}: {
  kind: "archive" | "delete";
  company: { id: string; name: string };
  onClose: () => void;
  onError: (message: string | null) => void;
  onSuccess: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameMatches = confirmName === company.name;
  const canSubmit = nameMatches && reason.trim().length > 0 && password.length > 0 && !saving;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={kind === "archive" ? `Archive "${company.name}"` : `Permanently delete "${company.name}"`}
    >
      <form
        action={async (formData) => {
          if (saving) return; // guard against a double submit
          setSaving(true);
          setLocalError(null);
          onError(null);
          const action = kind === "archive" ? archiveCompanyAction : deleteCompanyAction;
          const result = await action(formData);
          setSaving(false);
          if (result?.error) {
            setLocalError(result.error);
            return;
          }
          onClose();
          onSuccess();
        }}
        className="space-y-4"
      >
        <input type="hidden" name="companyId" value={company.id} />

        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] leading-5 text-negative">
          {kind === "archive"
            ? "The company becomes read-only immediately: no new invoices, bills, expenses or journal entries. Its books and history stay readable, and it can be restored later."
            : "This cannot be undone. Permanent deletion is only possible because this company has no invoices, bills, expenses, payments, customers, vendors, bank accounts or posted journal entries — there is nothing to lose, but the company record itself is gone for good."}
        </p>

        <Field label={`Type "${company.name}" to confirm`} required>
          <input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            name="confirmName"
            required
            className={inputClass}
            autoComplete="off"
          />
        </Field>

        <Field label="Reason" required hint="Written to the audit log.">
          <textarea
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            required
            className={inputClass}
          />
        </Field>

        <Field label="Confirm your password" required hint="Required for this action.">
          <input
            type="password"
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            className={inputClass}
            autoComplete="current-password"
          />
        </Field>

        {localError && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {localError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={kind === "delete" ? "danger" : "primary"} disabled={!canSubmit}>
            {saving ? "Working…" : kind === "archive" ? "Archive company" : "Permanently delete"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RestoreDialog({
  company,
  onClose,
  onError,
  onSuccess,
}: {
  company: { id: string; name: string };
  onClose: () => void;
  onError: (message: string | null) => void;
  onSuccess: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canSubmit = confirmName === company.name && !saving;

  return (
    <Modal open onClose={onClose} size="md" title={`Restore "${company.name}"`}>
      <form
        action={async (formData) => {
          if (saving) return;
          setSaving(true);
          setLocalError(null);
          onError(null);
          const result = await restoreCompanyAction(formData);
          setSaving(false);
          if (result?.error) {
            setLocalError(result.error);
            return;
          }
          onClose();
          onSuccess();
        }}
        className="space-y-4"
      >
        <input type="hidden" name="companyId" value={company.id} />
        <p className="text-[0.8125rem] leading-5 text-muted-ink">
          Reopens the company for posting. Blocked if it would put this subscription over its plan&apos;s company limit.
        </p>
        <Field label={`Type "${company.name}" to confirm`} required>
          <input
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            name="confirmName"
            required
            className={inputClass}
            autoComplete="off"
          />
        </Field>
        {localError && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {localError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {saving ? "Restoring…" : "Restore company"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
