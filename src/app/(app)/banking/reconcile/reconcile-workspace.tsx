"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, Money, inputClass } from "@/components/ui";
import { useMoney } from "@/components/currency-context";
import { completeReconciliationAction, startReconciliationAction, toggleClearedAction } from "../actions";

export function StartReconciliationForm({
  bankAccounts,
  defaultBankAccountId,
  defaultStart,
  defaultEnd,
  defaultOpening,
  suggestedClosing,
}: {
  bankAccounts: { id: string; name: string }[];
  defaultBankAccountId: string;
  defaultStart: string;
  defaultEnd: string;
  defaultOpening: string;
  suggestedClosing: string;
}) {
  const money = useMoney();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="Start a reconciliation" subtitle="Take the two balances from your bank statement" />
      <form
        action={async (formData) => {
          setError(null);
          const result = await startReconciliationAction(formData);
          if (result?.error) setError(result.error);
          else router.refresh();
        }}
        className="mt-3 space-y-3"
      >
        <Field label="Account" required>
          <select name="bankAccountId" defaultValue={defaultBankAccountId} className={clsx(inputClass, "pr-8")} required>
            {bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Statement start" required>
            <input type="date" name="statementStartDate" defaultValue={defaultStart} className={inputClass} required />
          </Field>
          <Field label="Statement end" required>
            <input type="date" name="statementEndDate" defaultValue={defaultEnd} className={inputClass} required />
          </Field>
        </div>
        <Field label="Opening balance" required hint="Carried forward from the last reconciliation.">
          <input name="openingBalance" defaultValue={defaultOpening} inputMode="decimal" className={clsx(inputClass, "tnum")} required />
        </Field>
        <Field label="Closing balance" required hint={`Your books show ${money.format(Math.round(Number(suggestedClosing) * 100))} at that date.`}>
          <input name="closingBalance" defaultValue={suggestedClosing} inputMode="decimal" className={clsx(inputClass, "tnum")} required />
        </Field>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full">Begin reconciliation</Button>
      </form>
    </Card>
  );
}

export function ReconcileWorkspace({
  reconciliationId,
  state,
  transactions,
}: {
  reconciliationId: string;
  state: {
    openingBalanceCents: number;
    closingBalanceCents: number;
    clearedDepositsCents: number;
    clearedWithdrawalsCents: number;
    clearedCountDeposits: number;
    clearedCountWithdrawals: number;
    clearedBalanceCents: number;
    differenceCents: number;
  };
  transactions: { id: string; date: string; description: string; amountCents: number; cleared: boolean; posted: boolean }[];
}) {
  const money = useMoney();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const balanced = state.differenceCents === 0;

  function toggle(transactionId: string, cleared: boolean) {
    startTransition(async () => {
      const result = await toggleClearedAction(reconciliationId, transactionId, cleared);
      if ("error" in result && result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
      <Card padded={false} className="p-5">
        <CardHeader
          title="Statement lines"
          subtitle={`${transactions.filter((t) => t.cleared).length} of ${transactions.length} cleared`}
        />
        <div className="thin-scroll mt-3 max-h-[36rem] overflow-y-auto">
          <table className="w-full text-[0.8125rem]">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-paper-300">
                <th className="w-10 pb-2" />
                <th className="pb-2 pr-4 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Date</th>
                <th className="pb-2 pr-4 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Description</th>
                <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Withdrawal</th>
                <th className="pb-2 pl-4 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Deposit</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr
                  key={transaction.id}
                  className={clsx("border-b border-paper-100 transition-colors", transaction.cleared ? "bg-positive-soft/40" : "hover:bg-paper-100")}
                >
                  <td className="py-2">
                    <input
                      type="checkbox"
                      checked={transaction.cleared}
                      disabled={pending}
                      onChange={(event) => toggle(transaction.id, event.target.checked)}
                      className="h-4 w-4 accent-[color:var(--color-positive)]"
                      aria-label={`Clear ${transaction.description}`}
                    />
                  </td>
                  <td className="py-2 pr-4 text-muted-ink">{transaction.date}</td>
                  <td className="py-2 pr-4 text-ink-800">
                    {transaction.description}
                    {!transaction.posted && (
                      <span className="ml-1.5 rounded bg-caution-soft px-1 py-px text-[0.625rem] uppercase text-caution">
                        not posted
                      </span>
                    )}
                  </td>
                  <td className="py-2 pl-4 text-right">
                    {transaction.amountCents < 0 && <Money cents={-transaction.amountCents} />}
                  </td>
                  <td className="py-2 pl-4 text-right">
                    {transaction.amountCents > 0 && <Money cents={transaction.amountCents} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="space-y-4 sticky-below-header">
        <Card>
          <CardHeader title="Difference" />
          <div
            className={clsx(
              "mt-3 rounded-lg p-4 text-center",
              balanced ? "bg-positive-soft" : "bg-caution-soft",
            )}
          >
            <p className={clsx("tnum text-[1.75rem] font-semibold tracking-[-0.02em]", balanced ? "text-positive" : "text-caution")}>
              {money.format(state.differenceCents)}
            </p>
            <p className={clsx("mt-0.5 text-[0.75rem]", balanced ? "text-positive" : "text-caution")}>
              {balanced ? "Reconciled — ready to finish" : "Keep clearing lines until this reaches zero"}
            </p>
          </div>

          <dl className="mt-4 space-y-1.5 text-[0.8125rem]">
            <Row label="Statement opening balance" value={state.openingBalanceCents} />
            <Row label={`Deposits cleared (${state.clearedCountDeposits})`} value={state.clearedDepositsCents} />
            <Row label={`Withdrawals cleared (${state.clearedCountWithdrawals})`} value={state.clearedWithdrawalsCents} />
            <div className="flex items-center justify-between border-t border-paper-300 pt-1.5 font-semibold">
              <dt className="text-ink-900">Cleared balance</dt>
              <dd><Money cents={state.clearedBalanceCents} bold /></dd>
            </div>
            <Row label="Statement closing balance" value={state.closingBalanceCents} />
          </dl>

          {error && (
            <p className="mt-3 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
              {error}
            </p>
          )}

          <Button
            variant="primary"
            className="mt-4 w-full"
            disabled={!balanced || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await completeReconciliationAction(reconciliationId);
                if ("error" in result && result.error) setError(result.error);
                else router.refresh();
              })
            }
          >
            {balanced ? "Finish reconciliation" : "Difference must be zero"}
          </Button>
        </Card>

        <Card>
          <CardHeader title="Why zero matters" />
          <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
            A difference of zero proves that every dollar the bank recorded is also in the ledger, and vice versa.
            Red Leaf Accounting will not let you finish a reconciliation while a difference remains — the alternative is a
            &ldquo;reconciled&rdquo; account nobody can trust.
          </p>
          <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
            If a line genuinely belongs in the books but is not on the statement yet, leave it uncleared: it becomes an
            outstanding item and carries forward to the next period.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  const money = useMoney();
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-ink">{label}</dt>
      <dd><Money cents={value} /></dd>
    </div>
  );
}
