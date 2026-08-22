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
}

export interface TaxRegistrationLine {
  label: string;
  value: string;
}

const REGISTRATIONS: { label: string; key: keyof TaxRegistrationSource }[] = [
  { label: "GST/HST", key: "gstNumber" },
  { label: "QST", key: "qstNumber" },
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
