"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import clsx from "clsx";
import { Button, Field, Select, inputClass } from "@/components/ui";
import { createPayRunAction, previewLineAction, updatePayRunAction } from "./actions";
import type { PayRunFormValues, PayRunLineFormValue } from "./pay-run-values";

interface BankAccountOption {
  id: string;
  code: string;
  name: string;
}

const money = (value: string) => Math.round((Number(value) || 0) * 100);
const fromCents = (cents: number) => (cents / 100).toFixed(2);

const EARNINGS_KEYS = [
  "regularPay",
  "overtimePay",
  "vacationPay",
  "sickPay",
  "bonus",
  "retroactivePay",
  "statutoryHolidayPay",
] as const;

function grossPayCents(line: PayRunLineFormValue): number {
  return EARNINGS_KEYS.reduce((total, key) => total + money(line[key]), 0);
}

function netPayCents(line: PayRunLineFormValue): number {
  return grossPayCents(line) - money(line.cpp) - money(line.cpp2) - money(line.ei) - money(line.federalTax) - money(line.provincialTax) - money(line.other);
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [calculating, setCalculating] = useState<string | null>(null);

  function setField<K extends keyof PayRunFormValues>(key: K, value: PayRunFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setLine(index: number, patch: Partial<PayRunLineFormValue>) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  function toggleExpanded(employeeId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  async function calculate(index: number) {
    const line = form.lines[index];
    if (!form.payDate) return setError("Set the pay date before calculating.");
    setError(null);
    setCalculating(line.employeeId);

    const payload = JSON.stringify({
      payDate: form.payDate,
      line: {
        employeeId: line.employeeId,
        regularHours: line.regularHours ? Number(line.regularHours) : null,
        overtimeHours: line.overtimeHours ? Number(line.overtimeHours) : null,
        regularPayCents: money(line.regularPay),
        overtimePayCents: line.overtimePay ? money(line.overtimePay) : null,
        vacationPayCents: money(line.vacationPay),
        sickPayCents: money(line.sickPay),
        bonusCents: money(line.bonus),
        retroactivePayCents: money(line.retroactivePay),
        statutoryHolidayPayCents: money(line.statutoryHolidayPay),
      },
    });

    const result = await previewLineAction(payload);
    setCalculating(null);
    if (result.error) return setError(result.error);

    setLine(index, {
      overtimePay: line.overtimePay || (result.overtimePayCents ? fromCents(result.overtimePayCents) : line.overtimePay),
      cpp: fromCents(result.cppCents ?? 0),
      cpp2: fromCents(result.cpp2Cents ?? 0),
      ei: fromCents(result.eiCents ?? 0),
      federalTax: fromCents(result.federalTaxCents ?? 0),
      provincialTax: fromCents(result.provincialTaxCents ?? 0),
      employerCpp: fromCents(result.employerCppCents ?? 0),
      employerCpp2: fromCents(result.employerCpp2Cents ?? 0),
      employerEi: fromCents(result.employerEiCents ?? 0),
    });
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
        overtimeHours: line.overtimeHours ? Number(line.overtimeHours) : null,
        regularPayCents: money(line.regularPay),
        overtimePayCents: line.overtimePay ? money(line.overtimePay) : null,
        vacationPayCents: money(line.vacationPay),
        sickPayCents: money(line.sickPay),
        bonusCents: money(line.bonus),
        retroactivePayCents: money(line.retroactivePay),
        statutoryHolidayPayCents: money(line.statutoryHolidayPay),
        cppCents: line.cpp ? money(line.cpp) : null,
        cpp2Cents: line.cpp2 ? money(line.cpp2) : null,
        eiCents: line.ei ? money(line.ei) : null,
        federalTaxCents: line.federalTax ? money(line.federalTax) : null,
        provincialTaxCents: line.provincialTax ? money(line.provincialTax) : null,
        otherDeductionsCents: money(line.other),
        employerCppCents: line.employerCpp ? money(line.employerCpp) : null,
        employerCpp2Cents: line.employerCpp2 ? money(line.employerCpp2) : null,
        employerEiCents: line.employerEi ? money(line.employerEi) : null,
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
        <Field label="Pay date" required hint="Determines the fiscal period this posts to, and which year's rates apply.">
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
            CPP, CPP2, EI and tax are suggested from the payroll rate tables once you set a pay date — click Calculate, then correct anything the engine gets wrong.
          </p>
        </div>

        <div className="thin-scroll -mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[86rem] border-collapse text-[0.8125rem]">
            <thead>
              <tr className="border-b border-paper-300 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">
                <th className="w-8 py-1.5 pr-2 text-left">{""}</th>
                <th className="py-1.5 pr-2 text-left">Employee</th>
                <th className="w-16 py-1.5 pr-2 text-right">Hours</th>
                <th className="w-16 py-1.5 pr-2 text-right">OT hrs</th>
                <th className="w-24 py-1.5 pr-2 text-right">Regular ($)</th>
                <th className="w-20 py-1.5 pr-2 text-right">CPP ($)</th>
                <th className="w-20 py-1.5 pr-2 text-right">CPP2 ($)</th>
                <th className="w-20 py-1.5 pr-2 text-right">EI ($)</th>
                <th className="w-24 py-1.5 pr-2 text-right">Fed tax ($)</th>
                <th className="w-24 py-1.5 pr-2 text-right">Prov tax ($)</th>
                <th className="w-20 py-1.5 pr-2 text-right">Other ($)</th>
                <th className="w-24 py-1.5 pr-2 text-right">Net pay</th>
                <th className="w-16 py-1.5 pr-2 text-left">{""}</th>
              </tr>
            </thead>
            <tbody>
              {form.lines.map((line, index) => {
                const isExpanded = expanded.has(line.employeeId);
                return (
                  <Fragment key={line.employeeId}>
                    <tr className={clsx("border-b border-paper-200", !line.include && "opacity-40")}>
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
                      <Cell value={line.overtimeHours} onChange={(v) => setLine(index, { overtimeHours: v })} disabled={!line.include} />
                      <Cell value={line.regularPay} onChange={(v) => setLine(index, { regularPay: v })} disabled={!line.include} bold />
                      <Cell value={line.cpp} onChange={(v) => setLine(index, { cpp: v })} disabled={!line.include} />
                      <Cell value={line.cpp2} onChange={(v) => setLine(index, { cpp2: v })} disabled={!line.include} />
                      <Cell value={line.ei} onChange={(v) => setLine(index, { ei: v })} disabled={!line.include} />
                      <Cell value={line.federalTax} onChange={(v) => setLine(index, { federalTax: v })} disabled={!line.include} />
                      <Cell value={line.provincialTax} onChange={(v) => setLine(index, { provincialTax: v })} disabled={!line.include} />
                      <Cell value={line.other} onChange={(v) => setLine(index, { other: v })} disabled={!line.include} />
                      <td className="tnum py-1.5 pr-2 text-right font-semibold text-ink-950">
                        {(netPayCents(line) / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}
                      </td>
                      <td className="py-1.5 pr-2 text-left">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(line.employeeId)}
                          disabled={!line.include}
                          className="text-[0.75rem] text-brand-700 hover:underline disabled:text-muted-ink"
                        >
                          {isExpanded ? "Less" : "Detail"}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-paper-200 bg-paper-50">
                        <td />
                        <td colSpan={12} className="py-2 pr-2">
                          <div className="flex flex-wrap items-end gap-3">
                            <LabeledCell label="Overtime pay" value={line.overtimePay} onChange={(v) => setLine(index, { overtimePay: v })} disabled={!line.include} />
                            <LabeledCell label="Vacation pay" value={line.vacationPay} onChange={(v) => setLine(index, { vacationPay: v })} disabled={!line.include} />
                            <LabeledCell label="Sick pay" value={line.sickPay} onChange={(v) => setLine(index, { sickPay: v })} disabled={!line.include} />
                            <LabeledCell label="Bonus" value={line.bonus} onChange={(v) => setLine(index, { bonus: v })} disabled={!line.include} />
                            <LabeledCell label="Retroactive pay" value={line.retroactivePay} onChange={(v) => setLine(index, { retroactivePay: v })} disabled={!line.include} />
                            <LabeledCell label="Stat holiday pay" value={line.statutoryHolidayPay} onChange={(v) => setLine(index, { statutoryHolidayPay: v })} disabled={!line.include} />
                            <LabeledCell label="Empr CPP" value={line.employerCpp} onChange={(v) => setLine(index, { employerCpp: v })} disabled={!line.include} />
                            <LabeledCell label="Empr CPP2" value={line.employerCpp2} onChange={(v) => setLine(index, { employerCpp2: v })} disabled={!line.include} />
                            <LabeledCell label="Empr EI" value={line.employerEi} onChange={(v) => setLine(index, { employerEi: v })} disabled={!line.include} />
                            <div>
                              <span className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">Gross</span>
                              <p className="tnum py-1 text-[0.8125rem] font-medium text-ink-900">
                                {(grossPayCents(line) / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}
                              </p>
                            </div>
                            <Button
                              type="button"
                              onClick={() => calculate(index)}
                              disabled={!line.include || calculating === line.employeeId}
                            >
                              {calculating === line.employeeId ? "Calculating…" : "Calculate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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

function LabeledCell({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <span className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        type="text"
        inputMode="decimal"
        className="tnum w-24 rounded-md border border-paper-300 bg-white px-1.5 py-1 text-right text-[0.8125rem] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-paper-100"
      />
    </div>
  );
}
