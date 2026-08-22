"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { useMoney } from "@/components/currency-context";
import {
  markInvoiceSentAction, postInvoiceAction, recordReceiptAction, voidInvoiceAction, writeOffInvoiceAction,
} from "../actions";

export function InvoiceActions({
  invoiceId,
  status,
  balanceCents,
  isPosted,
  sentAt,
  bankAccounts,
  canRecordPayment,
}: {
  invoiceId: string;
  status: string;
  balanceCents: number;
  isPosted: boolean;
  sentAt: string | null;
  bankAccounts: { id: string; name: string }[];
  canRecordPayment: boolean;
}) {
  const money = useMoney();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"payment" | "writeoff" | null>(null);

  function run(action: () => Promise<{ error?: string } | void>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!isPosted && status !== "VOID" && (
          <Button variant="primary" disabled={pending} onClick={() => run(() => postInvoiceAction(invoiceId))}>
            Post to ledger
          </Button>
        )}
        {isPosted && balanceCents > 0 && canRecordPayment && (
          <Button variant="primary" onClick={() => setDialog("payment")}>
            Record payment
          </Button>
        )}
        {isPosted && !sentAt && status !== "VOID" && (
          <Button disabled={pending} onClick={() => run(() => markInvoiceSentAction(invoiceId))}>
            Mark as sent
          </Button>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 transition-colors hover:bg-paper-100"
        >
          <Icon name="download" className="h-3.5 w-3.5" />
          Print / PDF
        </button>
        {isPosted && balanceCents > 0 && (
          <Button variant="ghost" onClick={() => setDialog("writeoff")}>
            Write off
          </Button>
        )}
        {status !== "VOID" && (
          <Button variant="danger" disabled={pending} onClick={() => run(() => voidInvoiceAction(invoiceId))}>
            Void
          </Button>
        )}
      </div>

      {error && (
        <p className="mt-2 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      {dialog === "payment" && (
        <Dialog title="Record a payment" onClose={() => setDialog(null)}>
          <form
            action={async (formData) => {
              const result = await recordReceiptAction(formData);
              if (result?.error) setError(result.error);
              else {
                setDialog(null);
                router.refresh();
              }
            }}
            className="space-y-3"
          >
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <Field label="Amount received" required hint={`Outstanding balance is ${money.format(balanceCents)}.`}>
              <input name="amount" defaultValue={(balanceCents / 100).toFixed(2)} inputMode="decimal" className={clsx(inputClass, "tnum")} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date received" required>
                <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} required />
              </Field>
              <Field label="Method">
                <select name="method" className={clsx(inputClass, "pr-8")} defaultValue="EFT">
                  <option value="EFT">EFT / e-transfer</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="CREDIT_CARD">Credit card</option>
                  <option value="CASH">Cash</option>
                </select>
              </Field>
            </div>
            <Field label="Deposit to" required>
              <select name="bankAccountId" className={clsx(inputClass, "pr-8")} required>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Reference">
              <input name="reference" className={inputClass} placeholder="EFT confirmation or cheque number" />
            </Field>
            <p className="rounded-md bg-paper-100 px-3 py-2 text-[0.75rem] leading-5 text-muted-ink">
              This posts <span className="font-medium text-ink-700">Dr Bank / Cr Accounts receivable</span> and applies
              the amount against this invoice.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="primary">Record payment</Button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "writeoff" && (
        <Dialog title="Write this invoice off" onClose={() => setDialog(null)}>
          <form
            action={async (formData) => {
              const result = await writeOffInvoiceAction(invoiceId, String(formData.get("reason") ?? ""));
              if (result?.error) setError(result.error);
              else {
                setDialog(null);
                router.refresh();
              }
            }}
            className="space-y-3"
          >
            <p className="text-[0.8125rem] leading-6 text-ink-700">
              Writing off posts <span className="font-medium">Dr Bad debt expense / Cr Accounts receivable</span> for the
              remaining {money.format(balanceCents)}. The invoice stays in the books with its history intact.
            </p>
            <Field label="Reason" required>
              <input name="reason" className={inputClass} placeholder="Customer insolvent — uncollectible" required />
            </Field>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="danger">Write off {money.format(balanceCents)}</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        className="rise w-full max-w-md rounded-xl border border-paper-300 bg-white p-5 shadow-[0_24px_64px_-16px_rgba(10,16,32,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-[1rem] font-semibold text-ink-950">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded text-ink-400 hover:bg-paper-200">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
