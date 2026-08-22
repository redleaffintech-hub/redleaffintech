"use client";

import { useState } from "react";
import clsx from "clsx";
import { PROVINCES } from "@/lib/enums";
import { Button, Field, SectionDivider, inputClass } from "@/components/ui";
import { createCustomerAction } from "@/app/(app)/sales/customers/actions";

export interface CustomerFormTaxCode {
  id: string;
  code: string;
  name: string;
}

/** What `createCustomerAction` hands back, and what the invoice editor consumes. */
export type CreatedCustomer = NonNullable<
  Awaited<ReturnType<typeof createCustomerAction>>["customer"]
>;

/** The five parts of an address, named once per side of the document. */
interface AddressFieldNames {
  line1: keyof FormState;
  line2: keyof FormState;
  city: keyof FormState;
  province: keyof FormState;
  postalCode: keyof FormState;
}

interface FormState {
  name: string;
  email: string;
  phone: string;
  taxCodeId: string;
  paymentTermsDays: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  shipToLine1: string;
  shipToLine2: string;
  shipToCity: string;
  shipToProvince: string;
  shipToPostalCode: string;
  notes: string;
}

const EMPTY: FormState = {
  name: "",
  email: "",
  phone: "",
  taxCodeId: "",
  paymentTermsDays: "15",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "",
  postalCode: "",
  shipToLine1: "",
  shipToLine2: "",
  shipToCity: "",
  shipToProvince: "",
  shipToPostalCode: "",
  notes: "",
};

const BILLING_FIELDS: AddressFieldNames = {
  line1: "addressLine1",
  line2: "addressLine2",
  city: "city",
  province: "province",
  postalCode: "postalCode",
};

const SHIPPING_FIELDS: AddressFieldNames = {
  line1: "shipToLine1",
  line2: "shipToLine2",
  city: "shipToCity",
  province: "shipToProvince",
  postalCode: "shipToPostalCode",
};

/**
 * The customer editor, used both as its own page and inside a dialog on the
 * invoice screen. One component, so the two entry points cannot drift on which
 * fields exist or on how a blank ship-to is interpreted.
 */
export function CustomerForm({
  taxCodes,
  defaultTermsDays,
  onCreated,
  onCancel,
  compact = false,
}: {
  taxCodes: CustomerFormTaxCode[];
  defaultTermsDays: number;
  onCreated: (customer: CreatedCustomer) => void;
  onCancel?: () => void;
  /** Tighter grid and no notes field, for the dialog on the invoice screen. */
  compact?: boolean;
}) {
  const [form, setForm] = useState<FormState>({ ...EMPTY, paymentTermsDays: String(defaultTermsDays) });
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set(key: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (!form.name.trim()) return setError("A customer needs a name.");

    setSaving(true);
    const result = await createCustomerAction(
      JSON.stringify({
        ...form,
        // Ticking "same as billing" stores no shipping address at all, which the
        // invoice editor reads as "fall back to the billing address". Storing a
        // copy instead would leave a stale one behind if billing were corrected.
        ...(sameAsBilling
          ? { shipToLine1: "", shipToLine2: "", shipToCity: "", shipToProvince: "", shipToPostalCode: "" }
          : {}),
      }),
    );
    setSaving(false);

    if (result?.error) return setError(result.error);
    if (result?.customer) onCreated(result.customer);
  }

  const cols = compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className="space-y-4">
      <div className={clsx("grid gap-3", cols)}>
        <Field label="Customer name" required className={compact ? "sm:col-span-2" : undefined}>
          <input
            autoFocus
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            className={inputClass}
            placeholder="Northbridge Logistics Inc."
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(event) => set("email", event.target.value)}
            className={inputClass}
            placeholder="ap@customer.ca"
          />
        </Field>
        <Field label="Phone">
          <input value={form.phone} onChange={(event) => set("phone", event.target.value)} className={inputClass} />
        </Field>
        <Field label="Default tax code" hint="Flows onto every invoice line raised for this customer.">
          <select
            value={form.taxCodeId}
            onChange={(event) => set("taxCodeId", event.target.value)}
            className={clsx(inputClass, "pr-8")}
          >
            <option value="">Use the invoice default</option>
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

      <SectionDivider label="Billing address" />
      <AddressBlock form={form} set={set} cols={cols} fields={BILLING_FIELDS} />

      <SectionDivider label="Shipping address" />
      <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem] text-ink-800">
        <input
          type="checkbox"
          checked={sameAsBilling}
          onChange={(event) => setSameAsBilling(event.target.checked)}
          className="h-3.5 w-3.5 accent-[color:var(--color-brand-600)]"
        />
        Same as the billing address
      </label>
      {!sameAsBilling && (
        <>
          <p className="text-[0.75rem] leading-5 text-muted-ink">
            The shipping province decides which sales tax an invoice charges, so set it whenever the goods or services
            are delivered somewhere other than the billing address.
          </p>
          <AddressBlock form={form} set={set} cols={cols} fields={SHIPPING_FIELDS} />
        </>
      )}

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
          {saving ? "Saving…" : "Save customer"}
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

function AddressBlock({
  form,
  set,
  cols,
  fields,
}: {
  form: FormState;
  set: (key: keyof FormState, value: string) => void;
  cols: string;
  fields: AddressFieldNames;
}) {
  return (
    <div className={clsx("grid gap-3", cols)}>
      <Field label="Address line 1" className="sm:col-span-2">
        <input value={form[fields.line1]} onChange={(event) => set(fields.line1, event.target.value)} className={inputClass} />
      </Field>
      <Field label="Address line 2">
        <input value={form[fields.line2]} onChange={(event) => set(fields.line2, event.target.value)} className={inputClass} />
      </Field>
      <Field label="City">
        <input value={form[fields.city]} onChange={(event) => set(fields.city, event.target.value)} className={inputClass} />
      </Field>
      <Field label="Province">
        <select
          value={form[fields.province]}
          onChange={(event) => set(fields.province, event.target.value)}
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
          value={form[fields.postalCode]}
          onChange={(event) => set(fields.postalCode, event.target.value.toUpperCase())}
          className={inputClass}
          placeholder="M5V 2T6"
        />
      </Field>
    </div>
  );
}
