"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import type { CurrencyOption } from "@/lib/currency";
import { PROVINCES } from "@/lib/enums";
import { saveCompanyProfileAction, saveNumberingAction } from "./actions";
import { FiscalYearField } from "./fiscal-year-field";

interface CompanyProfile {
  name: string;
  legalName: string;
  businessNumber: string;
  gstNumber: string;
  qstNumber: string;
  pstNumber: string;
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
  logoUrl: string | null;
}

/** Longest data URL the logo field accepts — keeps a Postgres text column and the page payload small. */
const MAX_LOGO_DATA_URL_LENGTH = 300_000;
const LOGO_MAX_DIMENSION = 256;

/**
 * Resize an uploaded image client-side and hand back a small data URL.
 *
 * There is no object storage configured for this app, so the logo is stored
 * directly on the Company row as a data URL — resizing first is what keeps
 * that column (and every page that loads it) small.
 */
async function fileToLogoDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read that image."));
      img.src = objectUrl;
    });

    const scale = Math.min(1, LOGO_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process that image.");
    ctx.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
  const [logoUrl, setLogoUrl] = useState<string | null>(company.logoUrl);
  const [logoError, setLogoError] = useState<string | null>(null);

  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    if (!file.type.startsWith("image/")) return setLogoError("Choose an image file.");
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      if (dataUrl.length > MAX_LOGO_DATA_URL_LENGTH) {
        return setLogoError("That image is too large even after resizing. Try a simpler logo.");
      }
      setLogoUrl(dataUrl);
    } catch {
      setLogoError("Could not read that image.");
    }
  }

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
        <input type="hidden" name="logoUrl" value={logoUrl ?? ""} />
        <Field label="Company logo" hint="Resized to fit within 256×256 and stored with this profile.">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a resized data URL, not an optimizable remote asset
              <img src={logoUrl} alt="Company logo" className="h-16 w-16 rounded-md border border-paper-300 object-contain bg-white p-1" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-paper-400 text-[0.6875rem] text-muted-ink">
                No logo
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="inline-flex cursor-pointer items-center rounded-md border border-paper-400 bg-white px-3 py-1.5 text-[0.8125rem] font-medium text-ink-800 hover:bg-paper-100">
                {logoUrl ? "Replace logo" : "Upload logo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => handleLogoFile(event.target.files?.[0])}
                />
              </label>
              {logoUrl && (
                <button
                  type="button"
                  onClick={() => setLogoUrl(null)}
                  className="text-left text-[0.75rem] text-muted-ink hover:underline"
                >
                  Remove logo
                </button>
              )}
            </div>
          </div>
          {logoError && <p className="mt-1.5 text-[0.75rem] text-negative">{logoError}</p>}
        </Field>

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
            <input name="gstNumber" defaultValue={company.gstNumber} maxLength={30} className={clsx(inputClass, "tnum")} placeholder="123456789 RT0001" />
          </Field>
          <Field label="QST number" hint="Québec sales tax registration, if you are registered.">
            <input name="qstNumber" defaultValue={company.qstNumber} maxLength={30} className={clsx(inputClass, "tnum")} placeholder="1234567890 TQ0001" />
          </Field>
          <Field label="PST number" hint="Provincial sales tax registration (BC, SK, MB).">
            <input name="pstNumber" defaultValue={company.pstNumber} maxLength={30} className={clsx(inputClass, "tnum")} placeholder="PST registration number" />
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
