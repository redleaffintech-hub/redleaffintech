"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { PROVINCES } from "@/lib/enums";
import { saveCompanyProfileAction, saveNumberingAction } from "./actions";

const MONTHS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1))),
}));

interface CompanyProfile {
  name: string;
  legalName: string;
  businessNumber: string;
  gstNumber: string;
  province: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  phone: string;
  email: string;
  website: string;
  fiscalYearStartMonth: number;
  defaultPaymentTermsDays: number;
  defaultTaxInclusive: boolean;
  invoiceFooter: string;
}

export function CompanyProfileForm({
  company,
  fiscalYearLocked,
  postedEntries,
}: {
  company: CompanyProfile;
  fiscalYearLocked: boolean;
  postedEntries: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Card className="p-5">
      <CardHeader title="Details" subtitle="Shown on invoices, quotes and statements" />
      <form
        action={async (formData) => {
          setError(null);
          const result = await saveCompanyProfileAction(formData);
          if (result?.error) setError(result.error);
          else {
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            router.refresh();
          }
        }}
        className="mt-4 space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Operating name" required>
            <input name="name" defaultValue={company.name} className={inputClass} required />
          </Field>
          <Field label="Legal name" hint="Used where the registered name must appear.">
            <input name="legalName" defaultValue={company.legalName} className={inputClass} />
          </Field>
          <Field label="Business number (BN)">
            <input name="businessNumber" defaultValue={company.businessNumber} className={clsx(inputClass, "tnum")} placeholder="123456789" />
          </Field>
          <Field label="GST/HST number" hint="Must appear on every invoice charging GST/HST.">
            <input name="gstNumber" defaultValue={company.gstNumber} className={clsx(inputClass, "tnum")} placeholder="123456789 RT0001" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Address" className="sm:col-span-2">
            <input name="addressLine1" defaultValue={company.addressLine1} className={inputClass} />
          </Field>
          <Field label="City">
            <input name="city" defaultValue={company.city} className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Province" required>
              <select name="province" defaultValue={company.province} className={clsx(inputClass, "pr-8")} required>
                {PROVINCES.map((province) => (
                  <option key={province.code} value={province.code}>{province.code}</option>
                ))}
              </select>
            </Field>
            <Field label="Postal code">
              <input name="postalCode" defaultValue={company.postalCode} className={clsx(inputClass, "uppercase")} />
            </Field>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Email">
            <input name="email" type="email" defaultValue={company.email} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input name="phone" defaultValue={company.phone} className={inputClass} />
          </Field>
          <Field label="Website">
            <input name="website" defaultValue={company.website} className={inputClass} />
          </Field>
        </div>

        <div className="grid gap-3 border-t border-paper-200 pt-4 sm:grid-cols-2">
          <Field
            label="Fiscal year starts"
            hint={
              fiscalYearLocked
                ? `Locked — ${postedEntries.toLocaleString("en-CA")} entries are already posted against these periods.`
                : "Sets every period boundary and the year-end date."
            }
          >
            <select
              name="fiscalYearStartMonth"
              defaultValue={String(company.fiscalYearStartMonth)}
              disabled={fiscalYearLocked}
              className={clsx(inputClass, "pr-8", fiscalYearLocked && "cursor-not-allowed bg-paper-100 text-muted-ink")}
            >
              {MONTHS.map((month) => (
                <option key={month.value} value={month.value}>{month.label}</option>
              ))}
            </select>
          </Field>
          {/* A disabled select submits nothing; keep the value in the payload. */}
          {fiscalYearLocked && <input type="hidden" name="fiscalYearStartMonth" value={company.fiscalYearStartMonth} />}

          <Field label="Default payment terms" hint="Days until an invoice is due.">
            <input
              name="defaultPaymentTermsDays"
              type="number"
              min={0}
              max={365}
              defaultValue={company.defaultPaymentTermsDays}
              className={clsx(inputClass, "tnum")}
            />
          </Field>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-paper-300 p-3">
          <input
            type="checkbox"
            name="defaultTaxInclusive"
            defaultChecked={company.defaultTaxInclusive}
            className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
          />
          <span className="text-[0.8125rem] leading-5 text-ink-800">
            Prices include tax by default
            <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
              New documents start tax-inclusive, with the tax backed out of the amount typed. Each document can still
              be switched.
            </span>
          </span>
        </label>

        <Field label="Invoice footer" hint="Payment instructions or terms printed at the bottom of every invoice.">
          <textarea name="invoiceFooter" defaultValue={company.invoiceFooter} rows={3} className={inputClass} />
        </Field>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        {saved && <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">Company profile saved.</p>}

        <div className="flex justify-end">
          <Button type="submit" variant="primary">Save changes</Button>
        </div>
      </form>
    </Card>
  );
}

const NUMBERING_FIELDS = [
  { name: "invoicePrefix", label: "Invoices", nextKey: "invoice" },
  { name: "estimatePrefix", label: "Sales quotes", nextKey: "estimate" },
  { name: "billPrefix", label: "Bills", nextKey: "bill" },
  { name: "creditPrefix", label: "Credit notes", nextKey: "credit" },
  { name: "paymentPrefix", label: "Payments", nextKey: "payment" },
  { name: "expensePrefix", label: "Expenses", nextKey: "expense" },
  { name: "journalPrefix", label: "Journal entries", nextKey: "journal" },
] as const;

export function NumberingForm({
  numbering,
  next,
}: {
  numbering: Record<string, string>;
  next: Record<string, number>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Card className="p-5">
      <CardHeader
        title="Document numbering"
        subtitle="Prefixes only — the sequence itself is what keeps numbering gapless"
      />
      <form
        action={async (formData) => {
          setError(null);
          const result = await saveNumberingAction(formData);
          if (result?.error) setError(result.error);
          else {
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            router.refresh();
          }
        }}
        className="mt-4 space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NUMBERING_FIELDS.map((field) => (
            <Field key={field.name} label={field.label} hint={`Next: ${numbering[field.name]}${next[field.nextKey]}`}>
              <input name={field.name} defaultValue={numbering[field.name]} maxLength={10} className={inputClass} />
            </Field>
          ))}
        </div>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        {saved && <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">Numbering saved.</p>}

        <div className="flex justify-end">
          <Button type="submit" variant="primary">Save numbering</Button>
        </div>
      </form>
    </Card>
  );
}
