"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Modal } from "@/components/modal";
import { changeFiscalYearStartAction, previewFiscalYearChangeAction } from "./actions";

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1))),
}));

const monthName = (m: number) => MONTHS.find((x) => x.value === m)?.label ?? String(m);

interface Plan {
  currentStartMonth: number;
  newStartMonth: number;
  postedEntries: number;
  existingPeriods: number;
  closedOrLockedPeriods: number;
  effectiveDate: string;
  effectiveFiscalYear: number;
  immediate: boolean;
  transition: { start: string; end: string; months: number } | null;
  firstNewYear: { fiscalYear: number; start: string; end: string };
  blockers: string[];
}

/**
 * The fiscal year start, and the workflow for moving it.
 *
 * Editable now rather than locked forever, but never as a silent field on the
 * profile form: the month defines every period boundary, so it saves through
 * its own action, which plans the change, shows what it will do, and writes the
 * new periods and the reason in one transaction.
 *
 * The select here is presentational — it opens the dialog rather than
 * submitting with the rest of the profile. That is why it carries no `name`.
 *
 * The parent keys this component on the saved month, so after a successful
 * change it remounts with the new value. That is cheaper and clearer than
 * syncing local state back from a prop inside an effect.
 */
export function FiscalYearField({
  currentMonth,
  postedEntries,
}: {
  currentMonth: number;
  postedEntries: number;
}) {
  const [selected, setSelected] = useState(currentMonth);
  const [open, setOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  return (
    <>
      <Field
        label="Fiscal year starts"
        hint={
          postedEntries > 0
            ? `Sets every period boundary. With ${postedEntries.toLocaleString("en-CA")} entries posted, a change applies to future years only.`
            : "Sets every period boundary and the year-end date."
        }
      >
        <select
          aria-label="Fiscal year starts"
          value={String(selected)}
          onChange={(event) => {
            const month = Number(event.target.value);
            setSelected(month);
            if (month !== currentMonth) setOpen(true);
          }}
          className={clsx(inputClass, "pr-8")}
        >
          {MONTHS.map((month) => (
            <option key={month.value} value={month.value}>{month.label}</option>
          ))}
        </select>
      </Field>

      {success && (
        <p className="mt-2 rounded-md bg-positive-soft px-3 py-2 text-[0.75rem] leading-5 text-positive sm:col-span-3">
          {success}
        </p>
      )}

      {open && (
        <FiscalYearDialog
          currentMonth={currentMonth}
          newMonth={selected}
          onClose={() => {
            setSelected(currentMonth);
            setOpen(false);
          }}
          onSuccess={(message) => {
            setSuccess(message);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function FiscalYearDialog({
  currentMonth,
  newMonth,
  onClose,
  onSuccess,
}: {
  currentMonth: number;
  newMonth: number;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [effectiveYear, setEffectiveYear] = useState<number | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, startLoading] = useTransition();

  // Re-plan whenever the effective year changes: the transition block and the
  // first new year both depend on it.
  useEffect(() => {
    startLoading(async () => {
      setLoadError(null);
      const result = await previewFiscalYearChangeAction(newMonth, effectiveYear);
      if ("plan" in result && result.plan) {
        setPlan(result.plan);
        if (effectiveYear === undefined) setEffectiveYear(Number(result.plan.effectiveDate.slice(0, 4)));
      } else {
        setLoadError("error" in result ? (result.error ?? "Could not work out what this change would do.") : "Could not work out what this change would do.");
        setPlan(null);
      }
    });
  }, [newMonth, effectiveYear]);

  const needsReason = (plan?.postedEntries ?? 0) > 0;
  const blocked = (plan?.blockers.length ?? 0) > 0;
  const canSave = plan !== null && !blocked && confirmed && (!needsReason || reason.trim().length > 0) && !saving;

  const yearChoices: number[] = [];
  if (plan) {
    const base = Number(plan.effectiveDate.slice(0, 4));
    for (let y = base; y <= base + 4; y++) yearChoices.push(y);
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Change the fiscal year start">
      <form
        action={async (formData) => {
          if (saving) return; // guard against a double submit
          setSaving(true);
          setError(null);
          const result = await changeFiscalYearStartAction(formData);
          setSaving(false);
          if ("error" in result && result.error) {
            setError(result.error);
            return;
          }
          // Report what actually happened — which month, from when, and
          // whether a transition year was needed.
          onSuccess("message" in result && result.message ? result.message : "Fiscal year start updated.");
          router.refresh();
        }}
        className="space-y-4"
      >
        <input type="hidden" name="fiscalYearStartMonth" value={newMonth} />
        {effectiveYear !== undefined && <input type="hidden" name="effectiveYear" value={effectiveYear} />}

        <div className="grid gap-3 rounded-lg border border-paper-300 p-3 text-[0.8125rem] sm:grid-cols-2">
          <Fact label="Current start" value={monthName(currentMonth)} />
          <Fact label="New start" value={monthName(newMonth)} />
          <Fact label="Posted journal entries" value={(plan?.postedEntries ?? 0).toLocaleString("en-CA")} />
          <Fact
            label="Existing fiscal periods"
            value={
              plan
                ? `${plan.existingPeriods.toLocaleString("en-CA")}` +
                  (plan.closedOrLockedPeriods ? ` (${plan.closedOrLockedPeriods} closed or locked)` : "")
                : "—"
            }
          />
        </div>

        {loading && !plan && <p className="text-[0.8125rem] text-muted-ink">Working out what this would do…</p>}
        {loadError && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {loadError}
          </p>
        )}

        {plan && !plan.immediate && (
          <Field label="Effective from fiscal year" hint="The new basis starts here. Everything before it keeps the old calendar.">
            <select
              value={String(effectiveYear ?? "")}
              onChange={(event) => setEffectiveYear(Number(event.target.value))}
              className={clsx(inputClass, "pr-8")}
            >
              {yearChoices.map((year) => (
                <option key={year} value={year}>
                  {monthName(newMonth)} {year}
                </option>
              ))}
            </select>
          </Field>
        )}

        {plan && (
          <div className="space-y-2 rounded-lg border border-paper-300 bg-paper-100 p-3 text-[0.8125rem] leading-6 text-ink-800">
            <p className="font-medium text-ink-900">What will happen</p>
            {plan.immediate ? (
              <p>
                Nothing has been posted, so the calendar is rebuilt on the new basis. Unused open periods are replaced;
                the first year runs {plan.firstNewYear.start} to {plan.firstNewYear.end}.
              </p>
            ) : (
              <>
                <p>
                  Every existing period keeps its dates and every posted entry keeps its period. Closed and locked
                  periods are not reopened or altered.
                </p>
                {plan.transition ? (
                  <p>
                    A <span className="font-medium">{plan.transition.months}-month transition</span> covers{" "}
                    {plan.transition.start} to {plan.transition.end}, bridging the old calendar to the new one.
                  </p>
                ) : (
                  <p>No transition period is needed — the new basis starts where the old one ends.</p>
                )}
                <p>
                  FY{plan.firstNewYear.fiscalYear} on the new basis runs {plan.firstNewYear.start} to{" "}
                  {plan.firstNewYear.end}.
                </p>
              </>
            )}
            <p className="text-muted-ink">
              Reports for earlier years keep their original boundaries; only future periods and report defaults use the
              new start month.
            </p>
          </div>
        )}

        {plan?.blockers.map((blocker) => (
          <p
            key={blocker}
            className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative"
          >
            {blocker}
          </p>
        ))}

        {needsReason && (
          <Field label="Reason for the change" required hint="Written to the audit log alongside who changed it and when.">
            <textarea
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              className={inputClass}
              placeholder="Aligning with the parent company's March year-end."
            />
          </Field>
        )}

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[color:var(--color-caution)]/40 bg-caution-soft p-3">
          <input
            type="checkbox"
            name="confirm"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-maple-600)]"
          />
          <span className="text-[0.8125rem] leading-5 text-ink-800">
            Change the fiscal year start to {monthName(newMonth)}
            <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
              This changes period boundaries and the year-end date for future reporting.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {saving ? "Applying…" : "Change fiscal year start"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-ink">{label}</span>
      <span className="tnum font-medium text-ink-900">{value}</span>
    </div>
  );
}
