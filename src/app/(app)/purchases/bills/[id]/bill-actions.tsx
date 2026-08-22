"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Dialog } from "@/app/(app)/sales/invoices/[id]/invoice-actions";
import { useMoney } from "@/components/currency-context";
import { approveBillAction, payBillAction, postBillAction, voidBillAction } from "../actions";

export function BillActions({
  billId,
  status,
  approvalStatus,
  balanceCents,
  isPosted,
  bankAccounts,
  canPay,
  canApprove,
  canEdit,
}: {
  billId: string;
  status: string;
  approvalStatus: string;
  balanceCents: number;
  isPosted: boolean;
  bankAccounts: { id: string; name: string }[];
  canPay: boolean;
  canApprove: boolean;
  canEdit: boolean;
}) {
  const money = useMoney();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  function run(action: () => Promise<{ error?: string } | { ok: boolean }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result && result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {approvalStatus === "PENDING" && canApprove && (
          <Button variant="primary" disabled={pending} onClick={() => run(() => approveBillAction(billId))}>
            Approve & post
          </Button>
        )}
        {approvalStatus !== "PENDING" && !isPosted && status !== "VOID" && canEdit && (
          <Button variant="primary" disabled={pending} onClick={() => run(() => postBillAction(billId))}>
            Post to ledger
          </Button>
        )}
        {isPosted && balanceCents > 0 && canPay && (
          <Button variant="primary" onClick={() => setPaying(true)}>
            Pay bill
          </Button>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100"
        >
          Print
        </button>
        {status !== "VOID" && canEdit && (
          <Button variant="danger" disabled={pending} onClick={() => run(() => voidBillAction(billId))}>
            Void
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      {paying && (
        <Dialog title="Pay this bill" onClose={() => setPaying(false)}>
          <form
            action={async (formData) => {
              const result = await payBillAction(formData);
              if (result?.error) setError(result.error);
              else {
                setPaying(false);
                router.refresh();
              }
            }}
            className="space-y-3"
          >
            <input type="hidden" name="billId" value={billId} />
            <Field label="Amount" required hint={`Balance owing is ${money.format(balanceCents)}.`}>
              <input name="amount" defaultValue={(balanceCents / 100).toFixed(2)} inputMode="decimal" className={clsx(inputClass, "tnum")} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment date" required>
                <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} required />
              </Field>
              <Field label="Method">
                <select name="method" className={clsx(inputClass, "pr-8")} defaultValue="EFT">
                  <option value="EFT">EFT</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="CREDIT_CARD">Credit card</option>
                  <option value="CASH">Cash</option>
                </select>
              </Field>
            </div>
            <Field label="Pay from" required>
              <select name="bankAccountId" className={clsx(inputClass, "pr-8")} required>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Reference">
              <input name="reference" className={inputClass} placeholder="Cheque or EFT number" />
            </Field>
            <p className="rounded-md bg-paper-100 px-3 py-2 text-[0.75rem] leading-5 text-muted-ink">
              Posts <span className="font-medium text-ink-700">Dr Accounts payable / Cr Bank</span> and applies the
              amount against this bill.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setPaying(false)}>Cancel</Button>
              <Button type="submit" variant="primary">Record payment</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
