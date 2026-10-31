/**
 * Minimal RFC 4180 CSV reader — the counterpart of csv.ts, which only writes.
 *
 * Handles quoted fields with embedded commas, quotes ("") and newlines, CRLF or
 * LF line endings, a leading UTF-8 BOM (Excel adds one), and blank lines.
 * It also undoes csv.ts's formula-injection guard (a leading tab inside quotes),
 * so a file exported by this app round-trips.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field.replace(/^\t/, ""));
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error("The file has an unclosed quote — a cell is missing its closing \".");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
