"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Money } from "@/components/ui";
import { ApplyRemainingForm } from "@/components/payment-detail-actions";
import { useMoney } from "@/components/currency-context";
import { formatDate } from "@/lib/dates";
import { applyReceiptAction, openInvoicesForCustomerAction } from "@/app/(app)/sales/receipts/actions";

interface ReceiptRow {
  id: string;
  number: string;
  date: string;
  method: string;
  amountCents: number;
  unappliedCents: number;
}

/**
 * "Apply deposit / credit" from the customer page (issue 7, 15 Sep 2026
 * review) — reuses the exact allocation form and validated server actions
 * the receipt's own detail page uses, so there is no second implementation
 * to drift from it. Applying creates allocations only: no new cash, bank,
 * revenue or tax entries.
 */
export function CustomerReceipts({ customerId, payments }: { customerId: string; payments: ReceiptRow[] }) {
  const router = useRouter();
  const money = useMoney();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  if (payments.length === 0) {
    return <p className="mt-2 text-[0.8125rem] text-muted-ink">No payments received yet.</p>;
  }

  return (
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
          {payment.unappliedCents > 0 && (
            <div className="mt-1.5">
              {applyingId === payment.id ? (
                <ApplyRemainingForm
                  paymentId={payment.id}
                  partyId={customerId}
                  unappliedCents={payment.unappliedCents}
                  applyAction={applyReceiptAction}
                  openDocumentsAction={openInvoicesForCustomerAction}
                  onCancel={() => setApplyingId(null)}
                  onApplied={() => {
                    setApplyingId(null);
                    router.refresh();
                  }}
                />
              ) : (
                <Button onClick={() => setApplyingId(payment.id)}>Apply deposit / credit</Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
