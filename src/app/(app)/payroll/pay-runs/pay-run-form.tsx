"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { Button, Field, Select, inputClass } from "@/components/ui";
import { createPayRunAction, updatePayRunAction } from "./actions";
import type { PayRunFormValues, PayRunLineFormValue } from "./pay-run-values";

interface BankAccountOption {
  id: string;
  code: string;
  name: string;
}

const money = (value: string) => Math.round((Number(value) || 0) * 100);

function netPayCents(line: PayRunLineFormValue): number {
  return (
    money(line.grossPay) - money(line.cpp) - money(line.ei) - money(line.federalTax) -
    money(line.provincialTax) - money(line.other)
  );
}

export function PayRunForm({
  initial,
  bankAccounts,
}: {
  initial: PayRunFormValues;
  bankAccounts: BankAccountOption[];
}) {
  const router = useRouter();
  const isNew = !initial.id;
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setField<K extends keyof PayRunFormValues>(key: K, value: PayRunFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLine(index: number, patch: Partial<PayRunLineFormValue>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  const includedCount = form.lines.filter((l) => l.include).length;

  async function submit() {
    setError(null);
    if (!form.payPeriodStart || !form.payPeriodEnd || !form.payDate) return setError("Fill in the pay period and pay date.");
    if (!form.bankAccountId) return setError("Choose the account net pay is paid from.");
    const included = form.lines.filter((l) => l.include);
    if (included.length === 0) return setError("Include at least one employee.");

    setSaving(true);
    const payload = JSON.stringify({
      payPeriodStart: form.payPeriodStart,
      payPeriodEnd: form.payPeriodEnd,
      payDate: form.payDate,
      bankAccountId: form.bankAccountId,
      memo: form.memo,
      lines: included.map((line) => ({
        employeeId: line.employeeId,
        regularHours: line.regularHours ? Number(line.regularHours) : null,
        grossPayCents: money(line.grossPay),
        cppCents: money(line.cpp),
        eiCents: money(line.ei),
        federalTaxCents: money(line.federalTax),
        provincialTaxCents: money(line.provincialTax),
        otherDeductionsCents: money(line.other),
        employerCppCents: money(line.employerCpp),
        employerEiCents: money(line.employerEi),
        notes: line.notes || null,
      })),
    });

    const result = isNew ? await createPayRunAction(payload) : await updatePayRunAction(initial.id!, payload);
    setSaving(false);

    if (result?.error) return setError(result.error);
    if (result?.payRunId) router.push(`/payroll/pay-runs/${result.payRunId}`);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Pay period start" required>
          <input type="date" value={form.payPeriodStart} onChange={(e) => setField("payPeriodStart", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Pay period end" required>
          <input type="date" value={form.payPeriodEnd} onChange={(e) => setField("payPeriodEnd", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Pay date" required hint="Determines the fiscal period this posts to.">
          <input type="date" value={form.payDate} onChange={(e) => setField("payDate", e.target.value)} className={inputClass} />
        </Field>
        <Field label="Pay net pay from" required>
          <Select value={form.bankAccountId} onChange={(e) => setField("bankAccountId", e.target.value)}>
            <option value="" disabled>Choose…</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Memo" hint="Appears on the journal entry.">
        <input value={form.memo} onChange={(e) => setField("memo", e.target.value)} className={inputClass} placeholder="Bi-weekly payroll" />
      </Field>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[0.9375rem] font-semibold text-ink-900">
            Employees <span className="tnum text-muted-ink">({includedCount} included)</span>
          </h2>
          <p className="text-[0.75rem] text-muted-ink">
            CPP, EI and tax figures are entered here, not calculated — get them from CRA&rsquo;s PDOC tool, a payroll service, or your accountant.
          </p>
        </div>

        <div className="thin-scroll -mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[72rem] border-collapse text-[0.8125rem]">
            <thead>
              <tr className="border-b border-paper-300 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                <th className="w-8 py-1.5 pr-2 text-left">{""}</th>
                <th className="py-1.5 pr-2 text-left">Employee</th>
                <th className="w-16 py-1.5 pr-2 text-right">Hours</th>
                <th className="w-24 py-1.5 pr-2 text-right">Gross ($)</th>
                <th className="w-20 py-1.5 pr-2 text-right">CPP ($)</th>
                <th className="w-20 py-1.5 pr-2 text-right">EI ($)</th>
                <th className="w-24 py-1.5 pr-2 text-right">Fed tax ($)</th>
                <th className="w-24 py-1.5 pr-2 text-right">Prov tax ($)</th>
                <th className="w-20 py-1.5 pr-2 text-right">Other ($)</th>
                <th className="w-24 py-1.5 pr-2 text-right">Empr CPP ($)</th>
                <th className="w-24 py-1.5 pr-2 text-right">Empr EI ($)</th>
                <th className="w-24 py-1.5 pr-2 text-right">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line, index) => (
                <tr key={line.employeeId} className={clsx("border-b border-paper-200", !line.include && "opacity-40")}>
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={line.include}
                      onChange={(e) => setLine(index, { include: e.target.checked })}
                      className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
                    />
                  </td>
                  <td className="py-1.5 pr-2 font-medium text-ink-900">{line.employeeName}</td>
                  <Cell value={line.regularHours} onChange={(v) => setLine(index, { regularHours: v })} disabled={!line.include} />
                  <Cell value={line.grossPay} onChange={(v) => setLine(index, { grossPay: v })} disabled={!line.include} bold />
                  <Cell value={line.cpp} onChange={(v) => setLine(index, { cpp: v })} disabled={!line.include} />
                  <Cell value={line.ei} onChange={(v) => setLine(index, { ei: v })} disabled={!line.include} />
                  <Cell value={line.federalTax} onChange={(v) => setLine(index, { federalTax: v })} disabled={!line.include} />
                  <Cell value={line.provincialTax} onChange={(v) => setLine(index, { provincialTax: v })} disabled={!line.include} />
                  <Cell value={line.other} onChange={(v) => setLine(index, { other: v })} disabled={!line.include} />
                  <Cell value={line.employerCpp} onChange={(v) => setLine(index, { employerCpp: v })} disabled={!line.include} />
                  <Cell value={line.employerEi} onChange={(v) => setLine(index, { employerEi: v })} disabled={!line.include} />
                  <td className="tnum py-1.5 pr-2 text-right font-semibold text-ink-950">
                    {(netPayCents(line) / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : isNew ? "Save draft" : "Save changes"}
        </Button>
        <Button onClick={() => router.back()} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}

function Cell({
  value,
  onChange,
  disabled,
  bold,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  bold?: boolean;
}) {
  return (
    <td className="py-1 pr-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        type="text"
        inputMode="decimal"
        className={clsx(
          "tnum w-full rounded-md border border-paper-300 bg-white px-1.5 py-1 text-right text-[0.8125rem] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-paper-100",
          bold && "font-medium",
        )}
      />
    </td>
  );
}
