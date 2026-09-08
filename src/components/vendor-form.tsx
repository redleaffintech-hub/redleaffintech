"use client";

import { useState } from "react";
import clsx from "clsx";
import { PROVINCES } from "@/lib/enums";
import { Button, Field, SectionDivider, inputClass } from "@/components/ui";
import { createVendorAction, updateVendorAction } from "@/app/(app)/purchases/vendors/actions";

export interface VendorFormTaxCode {
  id: string;
  code: string;
  name: string;
}

/** What `createVendorAction` hands back, and what the bill editor consumes. */
export type CreatedVendor = NonNullable<Awaited<ReturnType<typeof createVendorAction>>["vendor"]>;

/** An existing vendor's editable fields, as loaded for the edit page. */
export interface VendorFormValues {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  businessNumber: string | null;
  taxCodeId: string | null;
  paymentTermsDays: number;
  addressLine1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  notes: string | null;
}

function toFormState(vendor: VendorFormValues): FormState {
  return {
    name: vendor.name ?? "",
    email: vendor.email ?? "",
    phone: vendor.phone ?? "",
    businessNumber: vendor.businessNumber ?? "",
    taxCodeId: vendor.taxCodeId ?? "",
    paymentTermsDays: String(vendor.paymentTermsDays),
    addressLine1: vendor.addressLine1 ?? "",
    city: vendor.city ?? "",
    province: vendor.province ?? "",
    postalCode: vendor.postalCode ?? "",
    notes: vendor.notes ?? "",
  };
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  businessNumber: string;
  taxCodeId: string;
  paymentTermsDays: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
  notes: string;
}

const EMPTY: FormState = {
  name: "",
  email: "",
  phone: "",
  businessNumber: "",
  taxCodeId: "",
  paymentTermsDays: "30",
  addressLine1: "",
  city: "",
  province: "",
  postalCode: "",
  notes: "",
};

/**
 * The vendor editor, used both as its own page and inside a dialog on the bill
 * screen — same shape as `CustomerForm`, but vendors carry no address of ours
 * (no ship-to) since a bill is evidence of what they charged us, not something
 * we deliver.
 */
export function VendorForm({
  taxCodes,
  defaultTermsDays,
  onCreated,
  onSaved,
  onCancel,
  compact = false,
  vendor,
}: {
  taxCodes: VendorFormTaxCode[];
  defaultTermsDays: number;
  /** Called after a create, with the record the bill editor can select. */
  onCreated?: (vendor: CreatedVendor) => void;
  /** Called after an edit is saved. */
  onSaved?: () => void;
  onCancel?: () => void;
  /** Tighter grid and no notes field, for the dialog on the bill screen. */
  compact?: boolean;
  /** When set, the form edits this vendor instead of creating a new one. */
  vendor?: VendorFormValues;
}) {
  const [form, setForm] = useState<FormState>(
    vendor ? toFormState(vendor) : { ...EMPTY, paymentTermsDays: String(defaultTermsDays) },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (!form.name.trim()) return setError("A vendor needs a name.");

    setSaving(true);
    const result = vendor
      ? await updateVendorAction(vendor.id, JSON.stringify(form))
      : await createVendorAction(JSON.stringify(form));
    setSaving(false);

    if (result?.error) return setError(result.error);
    if (vendor) onSaved?.();
    else if (result?.vendor) onCreated?.(result.vendor);
  }

  const cols = compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className="space-y-4">
      <div className={clsx("grid gap-3", cols)}>
        <Field label="Vendor name" required className={compact ? "sm:col-span-2" : undefined}>
          <input
            autoFocus
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            className={inputClass}
            placeholder="Northbridge Supply Co."
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(event) => set("email", event.target.value)}
            className={inputClass}
            placeholder="ar@vendor.ca"
          />
        </Field>
        <Field label="Phone">
          <input value={form.phone} onChange={(event) => set("phone", event.target.value)} className={inputClass} />
        </Field>
        <Field label="Business number">
          <input
            value={form.businessNumber}
            onChange={(event) => set("businessNumber", event.target.value)}
            className={clsx(inputClass, "tnum")}
          />
        </Field>
        <Field label="Default tax code" hint="Flows onto every bill line raised for this vendor.">
          <select
            value={form.taxCodeId}
            onChange={(event) => set("taxCodeId", event.target.value)}
            className={clsx(inputClass, "pr-8")}
          >
            <option value="">Use the bill default</option>
            {taxCodes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.code} — {code.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment terms (days)">
          <input
            value={form.paymentTermsDays}
            onChange={(event) => set("paymentTermsDays", event.target.value)}
            inputMode="numeric"
            className={clsx(inputClass, "tnum")}
          />
        </Field>
      </div>

      <SectionDivider label="Address" />
      <div className={clsx("grid gap-3", cols)}>
        <Field label="Address line 1" className="sm:col-span-2">
          <input value={form.addressLine1} onChange={(event) => set("addressLine1", event.target.value)} className={inputClass} />
        </Field>
        <Field label="City">
          <input value={form.city} onChange={(event) => set("city", event.target.value)} className={inputClass} />
        </Field>
        <Field label="Province">
          <select
            value={form.province}
            onChange={(event) => set("province", event.target.value)}
            className={clsx(inputClass, "pr-8")}
          >
            <option value="">—</option>
            {PROVINCES.map((province) => (
              <option key={province.code} value={province.code}>
                {province.code} — {province.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Postal code">
          <input
            value={form.postalCode}
            onChange={(event) => set("postalCode", event.target.value.toUpperCase())}
            className={inputClass}
            placeholder="M5V 2T6"
          />
        </Field>
      </div>

      {!compact && (
        <>
          <SectionDivider label="Notes" />
          <Field label="Internal notes" hint="Never appears on a document.">
            <textarea
              value={form.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={3}
              className={inputClass}
            />
          </Field>
        </>
      )}

      {error && (
        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : vendor ? "Save changes" : "Save vendor"}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
