"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import type { CurrencyOption } from "@/lib/currency";
import { PROVINCES } from "@/lib/enums";
import { saveCompanyProfileAction, saveCustomerCodeAction, saveNumberingAction } from "./actions";
import { FiscalYearField } from "./fiscal-year-field";

type TaxStatus = "APPLICABLE" | "EXEMPT" | "NOT_APPLICABLE";

interface CompanyProfile {
  name: string;
  legalName: string;
  businessNumber: string;
  gstNumber: string;
  qstNumber: string;
  pstNumber: string;
  gstHstStatus: TaxStatus;
  qstStatus: TaxStatus;
  pstStatus: TaxStatus;
  baseCurrency: string;
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
  quoteFooter: string;
  creditNoteFooter: string;
}

const TAX_STATUS_OPTIONS: { value: TaxStatus; label: string; hint: string }[] = [
  { value: "APPLICABLE", label: "Applicable", hint: "Registered — charge it and show the number." },
  { value: "EXEMPT", label: "Exempt", hint: "Not required to charge it (e.g. small-supplier exemption)." },
  { value: "NOT_APPLICABLE", label: "Not applicable", hint: "Doesn't apply to this business." },
];

function TaxStatusField({
  label,
  name,
  status,
  onStatusChange,
  numberName,
  numberValue,
  numberHint,
  numberPlaceholder,
}: {
  label: string;
  name: string;
  status: TaxStatus;
  onStatusChange: (status: TaxStatus) => void;
  numberName: string;
  numberValue: string;
  numberHint: string;
  numberPlaceholder: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
      <Field
        label={label}
        hint={status === "APPLICABLE" ? numberHint : TAX_STATUS_OPTIONS.find((o) => o.value === status)?.hint}
      >
        <input
          name={numberName}
          defaultValue={numberValue}
          maxLength={30}
          className={clsx(inputClass, "tnum")}
          placeholder={numberPlaceholder}
          required={status === "APPLICABLE"}
        />
      </Field>
      <Field label="Collection status">
        <select
          name={name}
          value={status}
          onChange={(event) => onStatusChange(event.target.value as TaxStatus)}
          className={clsx(inputClass, "pr-8")}
        >
          {TAX_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export function CompanyProfileForm({
  company,
  currencies,
  postedEntries,
}: {
  company: CompanyProfile;
  currencies: CurrencyOption[];
  postedEntries: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [currency, setCurrency] = useState(company.baseCurrency);
  const [gstHstStatus, setGstHstStatus] = useState<TaxStatus>(company.gstHstStatus);
  const [qstStatus, setQstStatus] = useState<TaxStatus>(company.qstStatus);
  const [pstStatus, setPstStatus] = useState<TaxStatus>(company.pstStatus);

  // Relabelling a ledger is only worth warning about once something has been
  // posted into it; a file being set up can be corrected freely.
  const currencyChanged = currency !== company.baseCurrency;
  const currencyNeedsConfirmation = currencyChanged && postedEntries > 0;

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
        </div>

        <div className="space-y-3 border-t border-paper-200 pt-4">
          <p className="text-[0.75rem] leading-5 text-muted-ink">
            Each registration&apos;s collection status decides whether new sales documents charge that tax at all —
            existing documents and posted history are never affected by changing it.
          </p>
          <TaxStatusField
            label="GST/HST number"
            name="gstHstStatus"
            status={gstHstStatus}
            onStatusChange={setGstHstStatus}
            numberName="gstNumber"
            numberValue={company.gstNumber}
            numberHint="Must appear on every invoice charging GST/HST."
            numberPlaceholder="123456789 RT0001"
          />
          <TaxStatusField
            label="QST number"
            name="qstStatus"
            status={qstStatus}
            onStatusChange={setQstStatus}
            numberName="qstNumber"
            numberValue={company.qstNumber}
            numberHint="Québec sales tax registration."
            numberPlaceholder="1234567890 TQ0001"
          />
          <TaxStatusField
            label="PST number"
            name="pstStatus"
            status={pstStatus}
            onStatusChange={setPstStatus}
            numberName="pstNumber"
            numberValue={company.pstNumber}
            numberHint="Provincial sales tax registration (BC, SK, MB) or retail sales tax (MB)."
            numberPlaceholder="PST/RST registration number"
          />
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

        {/* The month is owned by FiscalYearField; the profile action ignores
            it but still validates its presence. */}
        <input type="hidden" name="fiscalYearStartMonth" value={company.fiscalYearStartMonth} />

        <div className="grid gap-3 border-t border-paper-200 pt-4 sm:grid-cols-3">
          <Field
            label="Base currency"
            hint="How amounts are displayed and reported. Does not convert anything."
          >
            <select
              name="baseCurrency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className={clsx(inputClass, "pr-8")}
              required
            >
              {currencies.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </Field>

          {/* Editable, but through its own confirmed workflow rather than as a
              field on this form — moving it rewrites period boundaries, so it
              must not ride along with a name or address edit. */}
          <FiscalYearField
            key={company.fiscalYearStartMonth}
            currentMonth={company.fiscalYearStartMonth}
            postedEntries={postedEntries}
          />

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

        {currencyNeedsConfirmation && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[color:var(--color-caution)]/40 bg-caution-soft p-3">
            <input
              type="checkbox"
              name="confirmCurrencyChange"
              className="mt-0.5 h-3.5 w-3.5 accent-[color:var(--color-maple-600)]"
            />
            <span className="text-[0.8125rem] leading-5 text-ink-800">
              Relabel this ledger from {company.baseCurrency} to {currency}
              <span className="mt-0.5 block text-[0.75rem] text-muted-ink">
                {postedEntries.toLocaleString("en-CA")} entries are already posted. Their amounts are stored as
                numbers with no currency attached, so this changes what every historical figure is presented as
                without converting any of it. Only do this if the file was set up under the wrong currency.
              </span>
            </span>
          </label>
        )}

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

        <div className="grid gap-3 border-t border-paper-200 pt-4 sm:grid-cols-3">
          <Field label="Invoice footer" hint="Payment instructions, printed at the bottom of every invoice.">
            <textarea name="invoiceFooter" defaultValue={company.invoiceFooter} rows={3} className={inputClass} />
          </Field>
          <Field label="Sales quote footer" hint="Terms or validity note, printed on quotes. Blank stays blank.">
            <textarea name="quoteFooter" defaultValue={company.quoteFooter} rows={3} className={inputClass} />
          </Field>
          <Field label="Credit note footer" hint="Printed on credit notes. Blank stays blank.">
            <textarea name="creditNoteFooter" defaultValue={company.creditNoteFooter} rows={3} className={inputClass} />
          </Field>
        </div>

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

/** `${prefix}${padded number}`, e.g. CUST-00042 — mirrors nextCustomerCode's
 * own formatting (src/server/documents/numbering.ts) for a live example. */
function previewCustomerCode(prefix: string, padding: number, next: number): string {
  return `${prefix}${String(next).padStart(Math.max(1, padding), "0")}`;
}

export function CustomerCodeForm({
  prefix,
  padding,
  next,
}: {
  prefix: string;
  padding: number;
  next: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [livePrefix, setLivePrefix] = useState(prefix);
  const [livePadding, setLivePadding] = useState(padding);

  return (
    <Card className="p-5">
      <CardHeader
        title="Customer codes"
        subtitle="A human-readable code shown instead of the internal customer ID"
      />
      <form
        action={async (formData) => {
          setError(null);
          const result = await saveCustomerCodeAction(formData);
          if (result?.error) setError(result.error);
          else {
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            router.refresh();
          }
        }}
        className="mt-4 space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prefix">
            <input
              name="customerCodePrefix"
              defaultValue={prefix}
              maxLength={10}
              className={inputClass}
              onChange={(event) => setLivePrefix(event.target.value)}
            />
          </Field>
          <Field label="Padding width" hint="How many digits the number is padded to.">
            <input
              name="customerCodePadding"
              type="number"
              min={1}
              max={10}
              defaultValue={padding}
              className={clsx(inputClass, "tnum")}
              onChange={(event) => setLivePadding(Number(event.target.value) || 1)}
            />
          </Field>
        </div>
        <p className="text-[0.75rem] leading-5 text-muted-ink">
          Next customer: <span className="tnum font-medium text-ink-900">{previewCustomerCode(livePrefix, livePadding, next)}</span>.
          Changing this affects only customers created from now on — existing codes never change.
        </p>

        {error && (
          <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
            {error}
          </p>
        )}
        {saved && <p className="rounded-md bg-positive-soft px-3 py-2 text-[0.8125rem] text-positive">Customer code settings saved.</p>}

        <div className="flex justify-end">
          <Button type="submit" variant="primary">Save</Button>
        </div>
      </form>
    </Card>
  );
}
