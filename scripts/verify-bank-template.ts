/** The downloadable bank-statement template must parse cleanly through the real importer. */
import "./load-env";
import { parseCsv } from "../src/server/banking/import";
import { BANK_STATEMENT_TEMPLATE_CSV } from "../src/lib/bank-statement-template";

let failed = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + d}`); if (!ok) failed++; };

const { rows, errors } = parseCsv(BANK_STATEMENT_TEMPLATE_CSV);
check("template parses with no errors", errors.length === 0, errors.join("; "));
check("three example rows", rows.length === 3, String(rows.length));
check("credit is money in", rows[0]?.amountCents === 125_000, String(rows[0]?.amountCents));
check("debit is money out", rows[1]?.amountCents === -200_000 && rows[2]?.amountCents === -4_500);
check("reference and balance are read", rows[0]?.reference === "DEP1001" && rows[0]?.balanceCents === 1_125_000);
check("dates are read as given", rows[0]?.date.toISOString().startsWith("2026-03-02"));

process.exit(failed ? 1 : 0);
