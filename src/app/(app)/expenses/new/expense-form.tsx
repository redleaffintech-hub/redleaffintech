"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { formatMoney, toCents } from "@/lib/money";
import { calculateTax, type TaxCodeSpec } from "@/server/tax/engine";
import { createExpenseAction } from "../actions";

/**
 * Quick expense capture. Receipt amounts are entered exactly as printed —
 * tax-inclusive — and the split is shown live before anything is posted.
 */
export function ExpenseForm({
  paymentAccounts,
  expenseAccounts,
  taxCodes,
  vendors,
}: {
  paymentAccounts: { id: string; code: string; name: string; subtype: string }[];
  expenseAccounts: { id: string; code: string; name: string; type: string }[];
  taxCodes: TaxCodeSpec[];
  vendors: { id: string; name: string; taxCodeId: string | null }[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [taxCodeId, setTaxCodeId] = useState(taxCodes.find((c) => c.components.length > 0)?.id ?? taxCodes[0]?.id ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const split = useMemo(() => {
    const code = taxCodes.find((c) => c.id === taxCodeId);
    let cents = 0;
    try {
      cents = toCents(amount);
    } catch {
      cents = 0;
    }
    if (!cents) return null;
    try {
      return calculateTax(
        code
          ? { ...code, effectiveFrom: new Date(code.effectiveFrom), effectiveTo: code.effectiveTo ? new Date(code.effectiveTo) : null }
          : null,
        cents,
        true,
        new Date(`${date}T00:00:00.000Z`),
      );
    } catch {
      return null;
    }
  }, [amount, taxCodeId, taxCodes, date]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
      <Card>
        <CardHeader title="Expense details" subtitle="Money that left a bank or card account directly" />
        <form
          action={async (formData) => {
            setError(null);
            setSaving(true);
            const result = await createExpenseAction(formData);
            setSaving(false);
            if (result?.error) setError(result.error);
            else if (result?.redirectTo) router.push(result.redirectTo);
          }}
          className="mt-4 space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required>
              <input type="date" name="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} required />
            </Field>
            <Field label="Amount on the receipt" required hint="Enter the total including tax.">
              <input
                name="amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className={clsx(inputClass, "tnum")}
                required
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid from" required>
              <select name="paymentAccountId" className={clsx(inputClass, "pr-8")} required>
                {paymentAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Method">
              <select name="paymentMethod" className={clsx(inputClass, "pr-8")} defaultValue="CREDIT_CARD">
                <option value="CREDIT_CARD">Credit card</option>
                <option value="DEBIT">Debit</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="EFT">EFT</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor" hint="Optional — links the expense to a vendor record.">
              <select name="vendorId" className={clsx(inputClass, "pr-8")} defaultValue="">
                <option value="">No vendor record</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Payee shown on the receipt">
              <input name="payeeName" className={inputClass} placeholder="Staples #0142" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required>
              <select name="accountId" className={clsx(inputClass, "pr-8")} required>
                {expenseAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} · {account.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tax code" required>
              <select
                name="taxCodeId"
                value={taxCodeId}
                onChange={(event) => setTaxCodeId(event.target.value)}
                className={clsx(inputClass, "pr-8")}
              >
                {taxCodes.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code} — {code.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference">
              <input name="reference" className={inputClass} placeholder="Receipt or transaction number" />
            </Field>
            <Field label="Memo">
              <input name="memo" className={inputClass} placeholder="What was this for?" />
            </Field>
          </div>

          {error && (
            <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Posting…" : "Record & post expense"}
            </Button>
            <a href="/expenses" className="inline-flex items-center rounded-md border border-paper-400 px-3 py-1.5 text-[0.8125rem] text-ink-700 hover:bg-paper-100">
              Cancel
            </a>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Tax split" subtitle="Backed out of the receipt total" />
        {split ? (
          <>
            <dl className="mt-3 space-y-1.5 text-[0.8125rem]">
              <Row label="Net expense" value={split.netCents} />
              {split.components.map((component) => (
                <Row
                  key={component.componentId}
                  label={`${component.name}${component.isRecoverable ? " (recoverable)" : " (not recoverable)"}`}
                  value={component.taxCents}
                />
              ))}
              <div className="flex items-center justify-between border-t border-paper-300 pt-2 font-semibold">
                <dt className="text-ink-900">Receipt total</dt>
                <dd className="tnum text-ink-950">{formatMoney(split.totalCents)}</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-md bg-paper-100 px-3 py-2 text-[0.75rem] leading-5 text-muted-ink">
              Recoverable tax is debited to the input tax credit account and claimed on your next return.
              Non-recoverable provincial tax is capitalised into the expense, because it is a real cost to the
              business.
            </p>
          </>
        ) : (
          <p className="mt-3 text-[0.8125rem] text-muted-ink">Enter an amount to see how the tax will be split.</p>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="tnum text-ink-900">{formatMoney(value)}</dd>
    </div>
  );
}
