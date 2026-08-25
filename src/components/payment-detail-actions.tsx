"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, inputClass } from "@/components/ui";
import { useMoney } from "@/components/currency-context";
import { formatDate } from "@/lib/dates";
import { toCents } from "@/lib/money";
import type { OpenDocument } from "./payment-form";

export function PaymentDetailActions({
  paymentId,
  status,
  unappliedCents,
  partyId,
  voidAction,
  applyAction,
  openDocumentsAction,
}: {
  paymentId: string;
  status: string;
  unappliedCents: number;
  partyId: string | null;
  voidAction: (paymentId: string) => Promise<{ error?: string; ok?: boolean }>;
  applyAction: (paymentId: string, payload: string) => Promise<{ error?: string; ok?: boolean }>;
  openDocumentsAction: (partyId: string) => Promise<OpenDocument[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  function voidPayment() {
    setError(null);
    startTransition(async () => {
      const result = await voidAction(paymentId);
      if (result?.error) setError(result.error);
      else router.refresh();
    });
  }

  const canVoid = status === "POSTED";
  const canApply = status === "POSTED" && unappliedCents > 0 && partyId;

  return (
    <section className="rounded-[--radius-card] border border-paper-300 bg-white p-5">
      {error && (
        <p className="mb-3 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {canApply && !applying && (
          <Button variant="primary" onClick={() => setApplying(true)}>
            Apply the remaining balance
          </Button>
        )}
        {canVoid && (
          <Button variant="danger" disabled={pending} onClick={voidPayment}>
            {pending ? "Voiding…" : "Void"}
          </Button>
        )}
        {!canVoid && status === "VOID" && (
          <p className="text-[0.8125rem] text-muted-ink">This record is void.</p>
        )}
      </div>

      {applying && partyId && (
        <div className="mt-4 border-t border-paper-200 pt-4">
          <ApplyRemainingForm
            paymentId={paymentId}
            partyId={partyId}
            unappliedCents={unappliedCents}
            applyAction={applyAction}
            openDocumentsAction={openDocumentsAction}
            onCancel={() => setApplying(false)}
            onApplied={() => {
              setApplying(false);
              router.refresh();
            }}
          />
        </div>
      )}
    </section>
  );
}

function ApplyRemainingForm({
  paymentId,
  partyId,
  unappliedCents,
  applyAction,
  openDocumentsAction,
  onCancel,
  onApplied,
}: {
  paymentId: string;
  partyId: string;
  unappliedCents: number;
  applyAction: (paymentId: string, payload: string) => Promise<{ error?: string; ok?: boolean }>;
  openDocumentsAction: (partyId: string) => Promise<OpenDocument[]>;
  onCancel: () => void;
  onApplied: () => void;
}) {
  const money = useMoney();
  const [documents, setDocuments] = useState<OpenDocument[] | null>(null);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This form is only mounted while "applying" is true, so a plain fetch-on-mount
  // is enough — partyId does not change during its lifetime.
  useEffect(() => {
    let cancelled = false;
    openDocumentsAction(partyId).then((docs) => {
      if (!cancelled) setDocuments(docs);
    });
    return () => {
      cancelled = true;
    };
  }, [partyId, openDocumentsAction]);

  const appliedCents = Object.values(applied).reduce((s, v) => s + safeCents(v), 0);
  const remaining = unappliedCents - appliedCents;

  function autoApply() {
    if (!documents) return;
    let left = unappliedCents;
    const next: Record<string, string> = {};
    for (const doc of documents) {
      if (left <= 0) break;
      const take = Math.min(left, doc.balanceCents);
      next[doc.id] = (take / 100).toFixed(2);
      left -= take;
    }
    setApplied(next);
  }

  async function submit() {
    setError(null);
    if (!documents) return;
    const allocations = documents
      .filter((doc) => safeCents(applied[doc.id]) > 0)
      .map((doc) => ({ documentId: doc.id, amount: applied[doc.id] }));
    if (allocations.length === 0) return setError("Apply an amount to at least one document.");
    if (remaining < 0) return setError("Applied amounts exceed the unapplied balance.");

    setSaving(true);
    const result = await applyAction(paymentId, JSON.stringify({ allocations }));
    setSaving(false);
    if (result?.error) return setError(result.error);
    onApplied();
  }

  return (
    <div className="space-y-3">
      <p className="text-[0.75rem] text-muted-ink">
        {money.format(unappliedCents)} unapplied.
      </p>

      {documents === null ? (
        <p className="text-[0.8125rem] text-muted-ink">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-ink">No open documents to apply this to.</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[0.75rem] font-medium text-ink-700">Open documents</span>
            <Button onClick={autoApply}>Auto-apply oldest first</Button>
          </div>
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1 text-[0.75rem]">
                  <p className="truncate font-medium text-ink-900">{doc.number}</p>
                  <p className="text-muted-ink">
                    Due {formatDate(new Date(doc.dueDate))} · {money.format(doc.balanceCents)}
                  </p>
                </div>
                <input
                  value={applied[doc.id] ?? ""}
                  onChange={(event) => setApplied((current) => ({ ...current, [doc.id]: event.target.value }))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={clsx(inputClass, "tnum w-24 text-right")}
                />
              </div>
            ))}
          </div>
          <p className={clsx("text-[0.75rem]", remaining < 0 ? "text-negative" : "text-muted-ink")}>
            {money.format(remaining)} left unapplied.
          </p>
        </>
      )}

      {error && <p className="text-[0.75rem] text-negative">{error}</p>}

      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={submit} disabled={saving || remaining < 0}>
          {saving ? "Applying…" : "Apply"}
        </Button>
        <Button onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}

function safeCents(value: string | undefined): number {
  if (!value || !value.trim()) return 0;
  try {
    return toCents(value);
  } catch {
    return 0;
  }
}
