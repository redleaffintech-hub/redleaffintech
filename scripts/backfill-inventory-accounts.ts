/**
 * One-off backfill: add the Inventory Asset and Cost of Goods Sold system
 * accounts to every company that predates the inventory module. New
 * companies get both automatically from CANADIAN_SERVICE_COA via
 * server/setup/provision.ts; this catches everyone provisioned before that
 * template gained the two accounts.
 *
 * Idempotent — safe to re-run. Skips a company that already has the
 * relevant systemKey, and falls back to the next free account code if the
 * template's own code (1450 / 5900) is already taken by something else in
 * that company's chart.
 *
 * `npm run backfill:inventory-accounts`
 */
import "./load-env";
import { db } from "../src/lib/db";
import { SYSTEM_ACCOUNTS } from "../src/lib/enums";
import { CANADIAN_SERVICE_COA } from "../src/server/setup/templates";

const TEMPLATES = [
  CANADIAN_SERVICE_COA.find((a) => a.systemKey === SYSTEM_ACCOUNTS.INVENTORY_ASSET)!,
  CANADIAN_SERVICE_COA.find((a) => a.systemKey === SYSTEM_ACCOUNTS.COST_OF_GOODS_SOLD)!,
];

async function freeCode(companyId: string, preferred: string): Promise<string> {
  const existing = await db.account.findMany({ where: { companyId }, select: { code: true } });
  const taken = new Set(existing.map((a) => a.code));
  if (!taken.has(preferred)) return preferred;
  const base = Number(preferred);
  for (let candidate = base + 1; candidate < base + 100; candidate++) {
    if (!taken.has(String(candidate))) return String(candidate);
  }
  throw new Error(`No free account code near ${preferred} for company ${companyId}.`);
}

async function main() {
  const companies = await db.company.findMany({ select: { id: true, name: true } });
  let created = 0;
  let skipped = 0;

  for (const company of companies) {
    for (const template of TEMPLATES) {
      const existing = await db.account.findFirst({
        where: { companyId: company.id, systemKey: template.systemKey },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      const code = await freeCode(company.id, template.code);
      await db.account.create({
        data: {
          companyId: company.id,
          code,
          name: template.name,
          type: template.type,
          subtype: template.subtype,
          systemKey: template.systemKey,
          description: template.description,
          isSystem: true,
        },
      });
      created++;
      console.log(`${company.name}: created ${code} ${template.name}${code !== template.code ? ` (template code ${template.code} was taken)` : ""}`);
    }
  }

  console.log(`Done. ${created} account(s) created, ${skipped} already present.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
