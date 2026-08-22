"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Badge, Button, Money, inputClass } from "@/components/ui";
import { Icon } from "@/components/shell/icons";
import { formatMoney } from "@/lib/money";
import { categorizeAction, excludeAction, matchAction, suggestionsAction } from "./actions";

export interface QueueTransaction {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  bankAccountName: string;
  bankAccountType: string;
}

interface Suggestion {
  matches: {
    kind: "INVOICE" | "BILL";
    id: string;
    number: string;
    partyName: string;
    date: string;
    balanceCents: number;
    confidence: number;
    reason: string;
  }[];
  rule: { ruleId: string; ruleName: string; accountId: string; taxCodeId: string | null; autoConfirm: boolean } | null;
}

/**
 * The bank review queue. Every confirmation here posts a real journal entry,
 * so the feed can never drift from the ledger.
 */
export function ReviewQueue({
  transactions,
  accounts,
  taxCodes,
  defaultExpenseAccountId,
  defaultTaxCodeId,
}: {
  transactions: QueueTransaction[];
  accounts: { id: string; code: string; name: string; type: string }[];
  taxCodes: { id: string; code: string; name: string }[];
  defaultExpenseAccountId: string;
  defaultTaxCodeId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(transactions[0]?.id ?? null);

  if (transactions.length === 0) {
    return (
      <div className="rounded-[--radius-card] border border-[color:var(--color-positive)]/25 bg-positive-soft px-5 py-10 text-center">
        <p className="text-[0.9375rem] font-semibold text-positive">The review queue is clear.</p>
        <p className="mt-1 text-[0.8125rem] text-positive/80">
          Every imported transaction has been categorised, matched or excluded.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {transactions.map((transaction) => (
        <QueueRow
          key={transaction.id}
          transaction={transaction}
          accounts={accounts}
          taxCodes={taxCodes}
          defaultExpenseAccountId={defaultExpenseAccountId}
          defaultTaxCodeId={defaultTaxCodeId}
          open={expanded === transaction.id}
          onToggle={() => setExpanded(expanded === transaction.id ? null : transaction.id)}
        />
      ))}
    </ul>
  );
}

function QueueRow({
  transaction,
  accounts,
  taxCodes,
  defaultExpenseAccountId,
  defaultTaxCodeId,
  open,
  onToggle,
}: {
  transaction: QueueTransaction;
  accounts: { id: string; code: string; name: string; type: string }[];
  taxCodes: { id: string; code: string; name: string }[];
  defaultExpenseAccountId: string;
  defaultTaxCodeId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [accountId, setAccountId] = useState(defaultExpenseAccountId);
  const [taxCodeId, setTaxCodeId] = useState(defaultTaxCodeId);
  const [error, setError] = useState<string | null>(null);

  const inflow = transaction.amountCents > 0;

  useEffect(() => {
    if (!open || suggestion) return;
    setLoading(true);
    suggestionsAction(transaction.id)
      .then((result) => {
        setSuggestion(result as Suggestion);
        if (result.rule) {
          setAccountId(result.rule.accountId);
          if (result.rule.taxCodeId) setTaxCodeId(result.rule.taxCodeId);
        }
      })
      .finally(() => setLoading(false));
  }, [open, suggestion, transaction.id]);

  function run(action: () => Promise<{ error?: string } | { ok: boolean }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result && result.error) setError(result.error);
      else router.refresh();
    });
  }

  const relevantAccounts = accounts.filter((a) => (inflow ? a.type === "REVENUE" || a.type === "ASSET" : a.type === "EXPENSE" || a.type === "ASSET" || a.type === "LIABILITY"));

  return (
    <li className={clsx("rounded-[--radius-card] border bg-white transition-shadow", open ? "border-ink-300 shadow-[0_8px_24px_-16px_rgba(10,16,32,0.35)]" : "border-paper-300")}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={clsx("grid h-8 w-8 shrink-0 place-items-center rounded-full", inflow ? "bg-positive-soft text-positive" : "bg-paper-200 text-ink-600")}>
          <Icon name={inflow ? "arrowDown" : "arrowUp"} className="h-4 w-4" />
        </span>
        <span className="w-[5.5rem] shrink-0 text-[0.75rem] text-muted-ink">{transaction.date}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.875rem] font-medium text-ink-900">{transaction.description}</span>
          <span className="block text-[0.75rem] text-muted-ink">{transaction.bankAccountName}</span>
        </span>
        {suggestion?.rule && <Badge tone="accent">rule: {suggestion.rule.ruleName}</Badge>}
        {suggestion && suggestion.matches.length > 0 && (
          <Badge tone="info">{suggestion.matches.length} possible match</Badge>
        )}
        <Money cents={transaction.amountCents} bold className={clsx("shrink-0 text-[0.9375rem]", inflow ? "text-positive" : "text-ink-900")} />
        <Icon name="chevronDown" className={clsx("h-4 w-4 shrink-0 text-ink-400 transition-transform", !open && "-rotate-90")} />
      </button>

      {open && (
        <div className="border-t border-paper-200 px-4 py-4">
          {loading && <p className="text-[0.8125rem] text-muted-ink">Looking for matches…</p>}

          {suggestion && suggestion.matches.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                Matches an open {inflow ? "invoice" : "bill"}
              </p>
              <ul className="space-y-1.5">
                {suggestion.matches.map((match) => (
                  <li key={match.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-paper-300 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8125rem] font-medium text-ink-900">
                        {match.number} — {match.partyName}
                      </span>
                      <span className="block text-[0.75rem] text-muted-ink">
                        Balance {formatMoney(match.balanceCents)} · {match.reason}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                        match.confidence >= 75 ? "bg-positive-soft text-positive" : "bg-caution-soft text-caution",
                      )}
                    >
                      {match.confidence}% confident
                    </span>
                    <Button
                      variant="primary"
                      disabled={pending}
                      onClick={() => run(() => matchAction(transaction.id, match.id, match.kind, Math.abs(transaction.amountCents)))}
                    >
                      Match & post payment
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.75rem] text-muted-ink">
                Matching records the payment, applies it to the document and posts{" "}
                {inflow ? "Dr Bank / Cr A/R" : "Dr A/P / Cr Bank"}.
              </p>
            </div>
          )}

          <div className="rounded-lg bg-paper-100 p-3">
            <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
              Or categorise straight to an account
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[16rem] flex-1">
                <span className="mb-1 block text-[0.75rem] text-ink-700">Account</span>
                <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={clsx(inputClass, "pr-8")}>
                  {relevantAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} · {account.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="w-36">
                <span className="mb-1 block text-[0.75rem] text-ink-700">Tax</span>
                <select value={taxCodeId} onChange={(event) => setTaxCodeId(event.target.value)} className={clsx(inputClass, "pr-8")}>
                  {taxCodes.map((code) => (
                    <option key={code.id} value={code.id}>{code.code}</option>
                  ))}
                </select>
              </label>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => run(() => categorizeAction(transaction.id, accountId, taxCodeId || null, transaction.description))}
              >
                {pending ? "Posting…" : "Confirm & post"}
              </Button>
              <Button disabled={pending} onClick={() => run(() => excludeAction(transaction.id))}>
                Exclude
              </Button>
            </div>
            <p className="mt-2 text-[0.75rem] text-muted-ink">
              The bank amount is treated as tax-inclusive: any recoverable GST/HST is split out to the ITC account and
              the rest hits the account above.
            </p>
          </div>

          {error && (
            <p className="mt-3 rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
