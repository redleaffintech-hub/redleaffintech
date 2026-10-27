/**
 * One-off backfill for PST/RST as an input tax credit: adds the PST/RST
 * Recoverable system account to every company that predates it, then points
 * each PST/RST tax component at it and marks the component recoverable. New
 * companies get both automatically from the provisioning templates.
 *
 * Posted history is untouched — TaxEntry rows snapshot the rate and the
 * recoverable amount at posting time, so only NEW bills/expenses/credit notes
 * post PST to the recoverable account. Existing bills keep their original
 * capitalised-into-expense journal entry.
 *
 * Idempotent. `npm run backfill:pst-recoverable`
 */
import "./load-env";
import { db } from "../src/lib/db";
import { SYSTEM_ACCOUNTS } from "../src/lib/enums";
import { CANADIAN_SERVICE_COA } from "../src/server/setup/templates";

const TEMPLATE = CANADIAN_SERVICE_COA.find((a) => a.systemKey === SYSTEM_ACCOUNTS.PST_RECOVERABLE)!;

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
  let components = 0;

  for (const company of companies) {
    let account = await db.account.findFirst({
      where: { companyId: company.id, systemKey: TEMPLATE.systemKey },
      select: { id: true },
    });
    if (!account) {
      const code = await freeCode(company.id, TEMPLATE.code);
      account = await db.account.create({
        data: {
          companyId: company.id,
          code,
          name: TEMPLATE.name,
          type: TEMPLATE.type,
          subtype: TEMPLATE.subtype,
          systemKey: TEMPLATE.systemKey,
          description: TEMPLATE.description,
          isSystem: true,
        },
        select: { id: true },
      });
      created++;
      console.log(`${company.name}: created ${code} ${TEMPLATE.name}`);
    }
    const res = await db.taxComponent.updateMany({
      where: {
        kind: { in: ["PST", "RST"] },
        taxCode: { companyId: company.id },
        OR: [{ isRecoverable: false }, { recoverableAccountId: null }],
      },
      data: { isRecoverable: true, recoverableAccountId: account.id },
    });
    components += res.count;
  }

  console.log(`Done. ${created} account(s) created, ${components} PST/RST component(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
