/**
 * Opening-balance CSV import: parser checks (no DB) and an end-to-end import into
 * a throwaway company on whatever DATABASE_URL points at (never run on production).
 *   npx tsx scripts/verify-opening-import.ts
 */
import "./load-env";
import { parseOpeningBalanceCsv } from "../src/server/documents/opening-balance-import";

let failures = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + d}`); if (!ok) failures++; };
const H = "Customer Name,Email,Phone,Address Line 1,Address Line 2,City,Province,Postal Code,Opening Balance,As of Date";

async function main() {
  const ok = parseOpeningBalanceCsv(`﻿${H}\r\n"Acme, Inc.",a@acme.ca,905,1 Main,Unit 4,Brampton,Ontario,l6y 1a1,"1,250.50",2026-03-31\r\nBeta,,,,,,,,0,\r\n`, "CUSTOMER");
  check("valid file parses", ok.errors.length === 0 && ok.rows.length === 2, JSON.stringify(ok.errors));
  check("quoted comma, province name, postal upcase, thousands amount", ok.rows[0]?.name === "Acme, Inc." && ok.rows[0].province === "ON" && ok.rows[0].postalCode === "L6Y 1A1" && ok.rows[0].amountCents === 125050);
  check("zero balance needs no date", ok.rows[1]?.amountCents === 0 && ok.rows[1].asOf === null);
  const bad = parseOpeningBalanceCsv(`${H}\nX,not-an-email,,,,,,,10,2026-01-01\nY,,,,,,Narnia,,10,2026-01-01\nZ,,,,,,,,abc,2026-01-01\nW,,,,,,,,-5,2026-01-01\nV,,,,,,,,10,31/12/2026\nU,,,,,,,,10,\n,,,,,,,,10,2026-01-01\nX,,,,,,,,10,2026-02-30\nB,,,,,,,,1,2026-01-01\nb,,,,,,,,1,2026-01-01`, "CUSTOMER");
  check("every bad row is reported (9 problems; row 10 is valid)", bad.errors.length === 9, String(bad.errors.length) + " " + JSON.stringify(bad.errors.map((e) => e.line)));
  check("missing column is explained", parseOpeningBalanceCsv("Name,Email\nA,b", "VENDOR").errors[0]?.message.includes("Opening Balance"));
  check("vendor header alias works", parseOpeningBalanceCsv("Vendor Name,Opening Balance,As of Date\nV,5,2026-01-01", "VENDOR").rows.length === 1);
  check("unclosed quote is reported", parseOpeningBalanceCsv(`${H}\n"oops,,`, "CUSTOMER").errors.length === 1);

  const url = process.env.DATABASE_URL ?? "";
  if (/neon\.tech/.test(url)) { console.log("SKIP  end-to-end (DATABASE_URL is Neon/production)"); }
  else {
    const { db } = await import("../src/lib/db");
    const { provisionCompany } = await import("../src/server/setup/provision");
    const { importOpeningBalances } = await import("../src/server/documents/opening-balance-import");
    const co = await db.$transaction((tx) => provisionCompany(tx, { name: "ZZ Import Probe", legalName: "ZZ", province: "ON", country: "CA", baseCurrency: "CAD", fiscalYearStartMonth: 1, plan: "BASIC", billingCycle: "MONTHLY" } as never), { timeout: 60000 });
    const run = async (kind: "CUSTOMER" | "VENDOR") => {
      const p = parseOpeningBalanceCsv(`${H}\nAcme,a@acme.ca,905,1 Main,Unit 4,Brampton,ON,L6Y 1A1,100.25,2026-01-31\nBeta,,,,,,,,0,\n`, kind);
      return importOpeningBalances({ companyId: co.id, userId: null as never, kind, rows: p.rows });
    };
    const ar = await run("CUSTOMER");
    check("e2e AR: 2 created, none failed", ar.created.length === 2 && ar.failed.length === 0, JSON.stringify(ar.failed));
    const c = await db.customer.findFirst({ where: { companyId: co.id, name: "Acme" } });
    check("e2e AR: shipTo copied from billing, balance recorded", c?.shipToLine1 === "1 Main" && c.shipToCity === "Brampton" && c.openingBalanceCents === 10025 && !!c.openingBalanceDocId && !!c.displayCode);
    const inv = await db.invoice.findFirst({ where: { companyId: co.id, customerId: c!.id } });
    check("e2e AR: posted invoice carries the balance", inv?.balanceCents === 10025 && inv.status !== "DRAFT", String(inv?.status));
    const ap = await run("VENDOR");
    const v = await db.vendor.findFirst({ where: { companyId: co.id, name: "Acme" } });
    check("e2e AP: vendor + posted bill", ap.failed.length === 0 && v?.openingBalanceCents === 10025 && !!v.openingBalanceDocId && v.notes === "Address line 2: Unit 4", JSON.stringify(ap.failed));
    console.log("note: probe company \"ZZ Import Probe\" is left in the local database (ledger rows block deletion).");
  }
  console.log(failures ? `\n${failures} FAILED` : "\nAll opening-import checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
