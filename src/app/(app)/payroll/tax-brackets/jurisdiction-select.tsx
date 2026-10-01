"use client";

import { PROVINCES } from "@/lib/enums";
import { Select } from "@/components/ui";
import { useQueryParams } from "@/components/shell/use-query-params";

export function JurisdictionSelect({ jurisdiction, companyProvince }: { jurisdiction: string; companyProvince: string }) {
  const { update } = useQueryParams();

  return (
    <Select
      aria-label="Jurisdiction"
      value={jurisdiction}
      onChange={(event) => update((next) => next.set("jurisdiction", event.target.value))}
      className="max-w-xs"
    >
      <option value="FEDERAL">Federal</option>
      {PROVINCES.map((p) => (
        <option key={p.code} value={p.code}>
          {p.name}
          {p.code === companyProvince ? " (this company)" : ""}
        </option>
      ))}
    </Select>
  );
}
