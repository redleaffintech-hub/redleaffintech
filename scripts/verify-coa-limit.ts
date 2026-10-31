/** The 500-account cap, including two simultaneous adds at 499. Local/dev DB only. */
import "./load-env";
import { db } from "../src/lib/db";
import { provisionCompany } from "../src/server/setup/provision";
import { createAccountWithinLimit } from "../src/server/accounting/account-create";
import { MAX_ACCOUNTS_PER_COMPANY } from "../src/lib/coa-limit";

let failures = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + d}`); if (!ok) failures++; };
const mk = (i: number) => ({ code: `9${String(i).padStart(4, "0")}`, name: `Probe ${i}`, type: "EXPENSE", subtype: "OPERATING_EXPENSE", description: null, isActive: true });

async function main() {
  if (/neon\.tech/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing to run against Neon/production.");
  const co = await db.$transaction((tx) => provisionCompany(tx, { name: "ZZ COA Probe", legalName: "ZZ", province: "ON", country: "CA", baseCurrency: "CAD", fiscalYearStartMonth: 1, plan: "BASIC", billingCycle: "MONTHLY" } as never), { timeout: 60000 });
  const have = await db.account.count({ where: { companyId: co.id } });
  const fill = MAX_ACCOUNTS_PER_COMPANY - 1 - have;
  await db.account.createMany({ data: Array.from({ length: fill }, (_, i) => ({ companyId: co.id, ...mk(i) })) });
  check("chart is at 499", (await db.account.count({ where: { companyId: co.id } })) === 499);

  const results = await Promise.all([createAccountWithinLimit(co.id, mk(90001)), createAccountWithinLimit(co.id, mk(90002))]);
  check("two simultaneous adds at 499: exactly one succeeds", results.filter(Boolean).length === 1);
  check("chart is now exactly 500", (await db.account.count({ where: { companyId: co.id } })) === 500);
  check("a further add is refused (null)", (await createAccountWithinLimit(co.id, mk(90003))) === null);
  check("still 500 after the refusal", (await db.account.count({ where: { companyId: co.id } })) === 500);
  console.log("note: 'ZZ COA Probe' company left in the local database.");
  console.log(failures ? `\n${failures} FAILED` : "\nAll COA-limit checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
