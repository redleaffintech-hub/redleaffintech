/**
 * One-off backfill: give every company that predates per-company module
 * access every module currently gateable in the nav (ACCOUNTING, PAYROLL,
 * HR, PAYMENTS, INVENTORY), so turning enforcement on does not lock anyone
 * out of something they already use. New clients created after this get a
 * deliberate selection from the admin client-create screen instead.
 *
 * Idempotent — skips any company that already has a non-empty enabledModules.
 *
 * `npm run backfill:company-modules`
 */
import "./load-env";
import { db } from "../src/lib/db";

const FULL_ACCESS = ["ACCOUNTING", "PAYROLL", "HR", "PAYMENTS", "INVENTORY"];

async function main() {
  const companies = await db.company.findMany({ select: { id: true, name: true, enabledModules: true } });
  let updated = 0;
  for (const company of companies) {
    if (company.enabledModules.length > 0) continue;
    await db.company.update({ where: { id: company.id }, data: { enabledModules: FULL_ACCESS } });
    updated++;
    console.log(`${company.name}: granted ${FULL_ACCESS.join(", ")}`);
  }
  console.log(`Done. ${updated} company(ies) updated, ${companies.length - updated} already set.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
