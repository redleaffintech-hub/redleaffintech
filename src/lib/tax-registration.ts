/**
 * Which tax registration numbers a document should print.
 *
 * A Canadian supplier must show the GST/HST registration on any invoice
 * charging GST/HST, and Québec requires the QST number alongside it. A business
 * registered in more than one regime therefore has to print more than one
 * number, each labelled — an unlabelled string of digits tells the recipient
 * nothing about which registration it is.
 *
 * Blank registrations are dropped rather than printed as an empty label, so a
 * company registered for GST only shows exactly one line.
 */

export interface TaxRegistrationSource {
  gstNumber: string | null;
  qstNumber: string | null;
  pstNumber: string | null;
  bcPstNumber?: string | null;
  mbRstNumber?: string | null;
  skPstNumber?: string | null;
}

export interface TaxRegistrationLine {
  label: string;
  value: string;
}

const REGISTRATIONS: { label: string; key: keyof TaxRegistrationSource }[] = [
  { label: "GST/HST", key: "gstNumber" },
  { label: "QST", key: "qstNumber" },
  { label: "BC PST", key: "bcPstNumber" },
  { label: "MB RST", key: "mbRstNumber" },
  { label: "SK PST", key: "skPstNumber" },
  // Legacy single number for a company outside BC/MB/SK; never shown under a province label.
  { label: "PST", key: "pstNumber" },
];

export function taxRegistrationLines(company: TaxRegistrationSource): TaxRegistrationLine[] {
  const lines: TaxRegistrationLine[] = [];
  for (const { label, key } of REGISTRATIONS) {
    const value = company[key]?.trim();
    if (value) lines.push({ label, value });
  }
  return lines;
}

/** The three provincial registrations, in display order. */
export const PST_REGISTRATIONS = [
  { field: "bcPstNumber", province: "BC", label: "British Columbia PST Number", placeholder: "PST-1234-5678" },
  { field: "mbRstNumber", province: "MB", label: "Manitoba RST/PST Number", placeholder: "123456-7" },
  { field: "skPstNumber", province: "SK", label: "Saskatchewan PST Number", placeholder: "1234567" },
] as const;

export type PstField = (typeof PST_REGISTRATIONS)[number]["field"];

/**
 * Validate and normalise one provincial registration. Blank is valid (every
 * field is optional) and returns null. Formats: BC PST-1234-5678 (8 digits),
 * Manitoba RST 123456-7 (7 digits), Saskatchewan PST 7 digits.
 */
export function normalizePstNumber(field: PstField, raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  const digits = text.replace(/^pst[\s-]*/i, "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: `${labelFor(field)} may contain digits only${field === "bcPstNumber" ? " (optionally prefixed PST-)" : ""}.` };
  if (field === "bcPstNumber") {
    if (digits.length !== 8) return { ok: false, error: "British Columbia PST Number must be 8 digits, e.g. PST-1234-5678." };
    return { ok: true, value: `PST-${digits.slice(0, 4)}-${digits.slice(4)}` };
  }
  if (field === "mbRstNumber") {
    if (digits.length !== 7) return { ok: false, error: "Manitoba RST/PST Number must be 7 digits, e.g. 123456-7." };
    return { ok: true, value: `${digits.slice(0, 6)}-${digits.slice(6)}` };
  }
  if (digits.length !== 7) return { ok: false, error: "Saskatchewan PST Number must be 7 digits, e.g. 1234567." };
  return { ok: true, value: digits };
}

function labelFor(field: PstField): string {
  return PST_REGISTRATIONS.find((r) => r.field === field)!.label;
}

export function normalizeAllPst(input: Partial<Record<PstField, string | null | undefined>>):
  | { ok: true; values: Record<PstField, string | null> }
  | { ok: false; error: string } {
  const values = {} as Record<PstField, string | null>;
  for (const { field } of PST_REGISTRATIONS) {
    const result = normalizePstNumber(field, input[field]);
    if (!result.ok) return result;
    values[field] = result.value;
  }
  return { ok: true, values };
}
