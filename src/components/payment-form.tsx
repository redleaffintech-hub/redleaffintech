"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Field, inputClass } from "@/components/ui";
import { useMoney } from "@/components/currency-context";
import { formatDate } from "@/lib/dates";
import { toCents } from "@/lib/money";

export interface OpenDocument {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  balanceCents: number;
}

export interface PartyOption {
  id: string;
  name: string;
}

const METHODS = [
  { value: "EFT", label: "EFT" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CREDIT_CARD", label: "Credit card" },
  { value: "CASH", label: "Cash" },
] as const;

/**
 * Records a receipt (customer, money in) or vendor payment (money out) and
 * allocates it across as many of that party's open documents as needed —
 * the multi-document case a single invoice/bill's own "Record payment" /
 * "Pay bill" dialog can't do, since it only ever knows about itself.
 */
export function PaymentForm({
  kind,
  parties,
  bankAccounts,
  openDocumentsAction,
  submitAction,
  cancelHref,
}: {
  kind: "RECEIPT" | "PAYMENT";
  parties: PartyOption[];
  bankAccounts: { id: string; name: string }[];
  /** Loads the selected party's open documents fresh — the list can change between page load and party pick. */
  openDocumentsAction: (partyId: string) => Promise<OpenDocument[]>;
  submitAction: (payload: string) => Promise<{ error?: string; redirectTo?: string }>;
  cancelHref: string;
}) {
  const money = useMoney();
  const router = useRouter();
  const partyLabel = kind === "RECEIPT" ? "Customer" : "Vendor";
  const documentNoun = kind === "RECEIPT" ? "invoice" : "bill";

  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id ?? "");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("EFT");
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const [amount, setAmount] = useState("");
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [loadingDocs, startLoadingDocs] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function loadDocuments(id: string) {
    setPartyId(id);
    setApplied({});
    if (!id) return setDocuments([]);
    startLoadingDocs(async () => {
      setDocuments(await openDocumentsAction(id));
    });
  }

  const amountCents = safeCents(amount);
  const appliedCents = Object.values(applied).reduce((s, v) => s + safeCents(v), 0);
  const unappliedCents = amountCents - appliedCents;

  function autoApply() {
    let remaining = amountCents;
    const next: Record<string, string> = {};
    for (const doc of documents) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, doc.balanceCents);
      next[doc.id] = (take / 100).toFixed(2);
      remaining -= take;
    }
    setApplied(next);
  }

  const partyOptions = useMemo(() => parties, [parties]);

  async function submit() {
    setError(null);
    if (!partyId) return setError(`Choose a ${partyLabel.toLowerCase()}.`);
    if (amountCents <= 0) return setError("Enter an amount greater than zero.");
    if (appliedCents > amountCents) return setError("Allocations exceed the amount.");

    setSaving(true);
    const result = await submitAction(
      JSON.stringify({
        partyId,
        date,
        bankAccountId,
        amount,
        method,
        reference: reference || undefined,
        memo: memo || undefined,
        allocations: documents
          .filter((doc) => safeCents(applied[doc.id]) > 0)
          .map((doc) => ({ documentId: doc.id, amount: applied[doc.id] })),
      }),
    );
    setSaving(false);
    if (result?.error) return setError(result.error);
    if (result?.redirectTo) router.push(result.redirectTo);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
      <div className="space-y-4">
        <section className="rounded-[--radius-card] border border-paper-300 bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={partyLabel} required>
              <select value={partyId} onChange={(event) => loadDocuments(event.target.value)} className={clsx(inputClass, "pr-8")}>
                {partyOptions.length === 0 && <option value="">No records yet</option>}
                {partyOptions.map((party) => (
                  <option key={party.id} value={party.id}>{party.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Amount" required>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className={clsx(inputClass, "tnum")}
              />
            </Field>
            <Field label="Date" required>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Method">
              <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)} className={clsx(inputClass, "pr-8")}>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field label={kind === "RECEIPT" ? "Deposit to" : "Pay from"} required>
              <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} className={clsx(inputClass, "pr-8")}>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Reference" hint={kind === "RECEIPT" ? "Cheque number, e-transfer id…" : "Cheque or EFT number"}>
              <input value={reference} onChange={(event) => setReference(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Memo" className="sm:col-span-2">
              <input value={memo} onChange={(event) => setMemo(event.target.value)} className={inputClass} />
            </Field>
          </div>
        </section>

        <section className="rounded-[--radius-card] border border-paper-300 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-200 px-5 py-3">
            <p className="text-[0.8125rem] font-medium text-ink-800">
              Open {documentNoun}s {partyId ? "" : `— choose a ${partyLabel.toLowerCase()} first`}
            </p>
            {documents.length > 0 && (
              <Button onClick={autoApply} disabled={amountCents <= 0}>
                Auto-apply oldest first
              </Button>
            )}
          </div>

          {loadingDocs ? (
            <p className="px-5 py-6 text-center text-[0.8125rem] text-muted-ink">Loading…</p>
          ) : documents.length === 0 ? (
            <p className="px-5 py-6 text-center text-[0.8125rem] text-muted-ink">
              {partyId ? `No open ${documentNoun}s for this ${partyLabel.toLowerCase()}.` : "—"}
            </p>
          ) : (
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="border-b border-paper-200">
                  <th className="px-5 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink">Number</th>
                  <th className="px-2 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink">Due</th>
                  <th className="px-2 py-2 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink">Balance</th>
                  <th className="px-5 py-2 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted-ink" style={{ width: "9rem" }}>Apply</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-b border-paper-100 last:border-0">
                    <td className="px-5 py-1.5 font-medium text-ink-900">{doc.number}</td>
                    <td className="px-2 py-1.5 text-muted-ink">{formatDate(new Date(doc.dueDate))}</td>
                    <td className="tnum px-2 py-1.5 text-right text-ink-800">{money.format(doc.balanceCents)}</td>
                    <td className="px-5 py-1.5">
                      <input
                        value={applied[doc.id] ?? ""}
                        onChange={(event) => setApplied((current) => ({ ...current, [doc.id]: event.target.value }))}
                        inputMode="decimal"
                        placeholder="0.00"
                        className={clsx(inputClass, "tnum text-right")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
      </div>

      <aside className="sticky-below-header">
        <section className="rounded-[--radius-card] border border-paper-300 bg-white p-5">
          <dl className="space-y-1.5 text-[0.8125rem]">
            <div className="flex justify-between">
              <dt className="text-muted-ink">Amount</dt>
              <dd className="tnum text-ink-900">{money.format(amountCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-ink">Applied</dt>
              <dd className="tnum text-ink-900">{money.format(appliedCents)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-paper-200 pt-1.5 font-semibold">
              <dt className="text-ink-900">Unapplied</dt>
              <dd className="tnum text-ink-950">{money.format(unappliedCents)}</dd>
            </div>
          </dl>
          {unappliedCents !== 0 && unappliedCents === amountCents && appliedCents === 0 && (
            <p className="mt-2 text-[0.75rem] leading-5 text-muted-ink">
              Left fully unapplied, this posts as an on-account {kind === "RECEIPT" ? "credit" : "prepayment"} you can
              apply to a document later.
            </p>
          )}
          {unappliedCents < 0 && (
            <p className="mt-2 text-[0.75rem] leading-5 text-negative">Applied amounts exceed the total.</p>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <Button variant="primary" onClick={submit} disabled={saving || unappliedCents < 0}>
              {saving ? "Saving…" : `Save ${kind === "RECEIPT" ? "receipt" : "payment"}`}
            </Button>
            <a href={cancelHref} className="inline-flex items-center justify-center rounded-md border border-paper-400 px-3 py-1.5 text-[0.8125rem] text-ink-700 hover:bg-paper-100">
              Cancel
            </a>
          </div>
        </section>
      </aside>
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
