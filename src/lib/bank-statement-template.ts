/**
 * The downloadable CSV template for bank statement import. Its headings are the
 * ones parseCsv in src/server/banking/import.ts reads back: Debit is money out
 * (withdrawals), Credit is money in (deposits), from the bank's point of view.
 */
export const BANK_STATEMENT_TEMPLATE_HEADINGS = ["Date", "Description", "Reference", "Debit", "Credit", "Balance"] as const;

const EXAMPLE_ROWS: string[][] = [
  ["2026-03-02", "Customer payment - Example Customer Inc.", "DEP1001", "", "1250.00", "11250.00"],
  ["2026-03-04", "Office rent", "CHQ2001", "2000.00", "", "9250.00"],
  ["2026-03-05", "Monthly account fee", "", "45.00", "", "9205.00"],
];

const quote = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const BANK_STATEMENT_TEMPLATE_CSV =
  [[...BANK_STATEMENT_TEMPLATE_HEADINGS], ...EXAMPLE_ROWS].map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n";
