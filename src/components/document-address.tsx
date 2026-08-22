"use client";

import clsx from "clsx";
import { PROVINCES } from "@/lib/enums";
import { Field, inputClass } from "@/components/ui";

/**
 * An address as it sits on a document — a snapshot, not a pointer at the party.
 * An issued invoice records what was sent; correcting the customer afterwards
 * must not rewrite it.
 */
export interface DocumentAddress {
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postalCode: string;
}

export const EMPTY_ADDRESS: DocumentAddress = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  province: "",
  postalCode: "",
};

/** Build a document address from whatever a party record happens to hold. */
export function addressFromParty(
  name: string,
  parts: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
  } | null,
): DocumentAddress {
  return {
    name,
    line1: parts?.line1 ?? "",
    line2: parts?.line2 ?? "",
    city: parts?.city ?? "",
    province: parts?.province ?? "",
    postalCode: parts?.postalCode ?? "",
  };
}

export function isAddressEmpty(address: DocumentAddress) {
  return !address.line1 && !address.line2 && !address.city && !address.province && !address.postalCode;
}

export function AddressEditor({
  value,
  onChange,
  onProvinceChange,
  provinceHint,
}: {
  value: DocumentAddress;
  onChange: (next: DocumentAddress) => void;
  /**
   * Separate from `onChange` because changing the ship-to province re-rates the
   * whole document, which is more than a field edit.
   */
  onProvinceChange?: (province: string) => void;
  provinceHint?: string;
}) {
  function set(key: keyof DocumentAddress, next: string) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" className="sm:col-span-2">
        <input value={value.name} onChange={(event) => set("name", event.target.value)} className={inputClass} />
      </Field>
      <Field label="Address line 1" className="sm:col-span-2">
        <input value={value.line1} onChange={(event) => set("line1", event.target.value)} className={inputClass} />
      </Field>
      <Field label="Address line 2" className="sm:col-span-2">
        <input value={value.line2} onChange={(event) => set("line2", event.target.value)} className={inputClass} />
      </Field>
      <Field label="City">
        <input value={value.city} onChange={(event) => set("city", event.target.value)} className={inputClass} />
      </Field>
      <Field label="Postal code">
        <input
          value={value.postalCode}
          onChange={(event) => set("postalCode", event.target.value.toUpperCase())}
          className={inputClass}
          placeholder="M5V 2T6"
        />
      </Field>
      <Field label="Province" className="sm:col-span-2" hint={provinceHint}>
        <select
          value={value.province}
          onChange={(event) =>
            onProvinceChange ? onProvinceChange(event.target.value) : set("province", event.target.value)
          }
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
    </div>
  );
}

/** The same address rendered the way it prints on the document. */
export function AddressLines({ address, className }: { address: DocumentAddress; className?: string }) {
  const region = [address.city, address.province, address.postalCode].filter(Boolean).join(", ");
  if (isAddressEmpty(address) && !address.name) {
    return <p className={clsx("text-[0.8125rem] text-ink-400", className)}>—</p>;
  }
  return (
    <p className={clsx("text-[0.8125rem] leading-6 text-muted-ink", className)}>
      {address.name && <span className="block font-medium text-ink-900">{address.name}</span>}
      {address.line1 && <>{address.line1}<br /></>}
      {address.line2 && <>{address.line2}<br /></>}
      {region}
    </p>
  );
}
