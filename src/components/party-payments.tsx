"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Money } from "@/components/ui";
import { ApplyRemainingForm } from "@/components/payment-detail-actions";
import { UnallocateButton } from "@/components/unallocate-button";
import { useMoney } from "@/components/currency-context";
import { formatDate } from "@/lib/dates";
import { unallocateWholePaymentAction } from "@/app/actions/unallocate";
import type { OpenDocument } from "@/components/payment-form";

interface AllocationRow {
  id: string;
  documentNumber: string;
  amountCents: number;
}

export interface PartyPaymentRow {
  id: string;
  number: string;
  date: string;
  method: string;
  amountCents: number;
  unappliedCents: number;
  /** Cash allocations only — credit-note applications are undone from the credit note. */
  allocations: AllocationRow[];
}

/**
 * Apply / Unapply payment from a customer or vendor page. Reuses the exact
 * allocation form and validated server actions the payment's own detail page
 * uses, so there is one implementation for both sides. Neither action posts a
 * journal entry: the cash stays booked, only the payment-to-document link changes.
 */
export function PartyPayments({
  partyId,
  payments,
  applyAction,
  openDocumentsAction,
  emptyText,
  applyLabel,
  documentWord,
}: {
  partyId: string;
  payments: PartyPaymentRow[];
  applyAction: (paymentId: string, payload: string) => Promise<{ error?: string; ok?: boolean }>;
  openDocumentsAction: (partyId: string) => Promise<OpenDocument[]>;
  emptyText: string;
  applyLabel: string;
  documentWord: "invoice" | "bill";
}) {
  const router = useRouter();
  const money = useMoney();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (payments.length === 0) return <p className="mt-2 text-[0.8125rem] text-muted-ink">{emptyText}</p>;

  function unapplyAll(payment: PartyPaymentRow) {
    if (!confirm(`Unapply all of ${payment.number} (${money.format(payment.amountCents - payment.unappliedCents)})? The ${documentWord}s reopen and the money returns to unapplied credit.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await unallocateWholePaymentAction(payment.id);
      if ("error" in result && result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <>
      <ul className="mt-3 divide-y divide-paper-200">
        {payments.map((payment) => (
          <li key={payment.id} className="py-2 text-[0.8125rem]">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink-900">{payment.number}</span>
                <span className="text-[0.75rem] text-muted-ink">
                  {formatDate(new Date(payment.date))} · {payment.method}
                  {payment.unappliedCents > 0 && ` · ${money.format(payment.unappliedCents)} unapplied`}
                </span>
              </span>
              <Money cents={payment.amountCents} bold />
            </div>

            {payment.allocations.length > 0 && (
              <ul className="mt-1 space-y-0.5 pl-3 text-[0.75rem] text-muted-ink">
                {payment.allocations.map((allocation) => (
                  <li key={allocation.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">Applied to {allocation.documentNumber}</span>
                    <Money cents={allocation.amountCents} />
                    <UnallocateButton
                      allocationId={allocation.id}
                      paymentNumber={payment.number}
                      documentNumber={allocation.documentNumber}
                      label="Unapply"
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {applyingId === payment.id ? (
                <ApplyRemainingForm
                  paymentId={payment.id}
                  partyId={partyId}
                  unappliedCents={payment.unappliedCents}
                  applyAction={applyAction}
                  openDocumentsAction={openDocumentsAction}
                  onCancel={() => setApplyingId(null)}
                  onApplied={() => {
                    setApplyingId(null);
                    router.refresh();
                  }}
                />
              ) : (
                <>
                  {payment.unappliedCents > 0 && <Button onClick={() => setApplyingId(payment.id)}>{applyLabel}</Button>}
                  {payment.allocations.length > 1 && (
                    <Button onClick={() => unapplyAll(payment)} disabled={pending}>
                      Unapply all
                    </Button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[0.75rem] text-negative">{error}</p>}
    </>
  );
}
