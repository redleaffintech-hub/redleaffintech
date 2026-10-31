/**
 * Give every existing company the published sales-tax codes for every province,
 * so no invoice ever stops to ask for them (new companies get them at setup).
 *
 * Idempotent: codes a company already has are skipped, and an existing code is
 * never edited — rates are effective-dated, not changed in place.
 *
 *   npx tsx scripts/backfill-provincial-tax-codes.ts          dry run (counts only)
 *   npx tsx scripts/backfill-provincial-tax-codes.ts --apply  write
 */
import "./load-env";
import { db } from "../src/lib/db";
import { PROVINCES } from "../src/lib/enums";
import { createProvincialTaxCodes } from "../src/server/setup/provision";
import { provincialTaxCodeTemplates } from "../src/server/tax/regional-rates";

const APPLY = process.argv.includes("--apply");

async function main() {
  const companies = await db.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}  ${companies.length} companies\n`);
  let total = 0;

  for (const company of companies) {
    const existing = new Set((await db.taxCode.findMany({ where: { companyId: company.id }, select: { code: true } })).map((t) => t.code));
    let missing = 0;
    for (const p of PROVINCES) for (const t of await provincialTaxCodeTemplates(p.code)) if (!existing.has(t.code)) missing++;
    if (missing === 0) { console.log(`${company.name}: complete`); continue; }

    if (APPLY) {
      const added = await db.$transaction(
        async (tx) => {
          let n = 0;
          for (const p of PROVINCES) n += (await createProvincialTaxCodes(tx, company.id, p.code)).length;
          return n;
        },
        { timeout: 60_000 },
      );
      console.log(`${company.name}: added ${added} code(s)`);
      total += added;
    } else {
      console.log(`${company.name}: ${missing} code(s) to add`);
      total += missing;
    }
  }
  console.log(`\n${total} code(s) ${APPLY ? "added" : "would be added"}.${APPLY ? "" : "  Re-run with --apply to write."}`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
