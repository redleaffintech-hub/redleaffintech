/**
 * Bring every subscription down to the default of 2 included users (plus any paid
 * extras), and the Basic plan's working copy with it.
 *
 * Never cuts below the people already on the company: a company with more active
 * users than the default keeps its current limit and is listed, so it can be dealt
 * with on purpose rather than locked out.
 *
 *   npx tsx scripts/backfill-default-seats.ts          dry run
 *   npx tsx scripts/backfill-default-seats.ts --apply  write
 */
import "./load-env";
import { db } from "../src/lib/db";
import { INCLUDED_USERS } from "../src/lib/seats";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}\n`);

  const plans = await db.plan.findMany({ where: { seats: { not: INCLUDED_USERS } }, select: { id: true, code: true, seats: true } });
  for (const p of plans) console.log(`plan ${p.code}: seats ${p.seats} -> ${INCLUDED_USERS}`);
  if (APPLY && plans.length) await db.plan.updateMany({ where: { id: { in: plans.map((p) => p.id) } }, data: { seats: INCLUDED_USERS } });

  const subs = await db.subscription.findMany({
    select: { id: true, companyId: true, seats: true, extraSeats: true, seatsOverridden: true, company: { select: { name: true } } },
  });
  for (const s of subs) {
    const target = INCLUDED_USERS + s.extraSeats;
    if (s.seats === target) continue;
    const used = await db.companyUser.count({ where: { companyId: s.companyId, status: { in: ["ACTIVE", "INVITED"] } } });
    if (s.seatsOverridden) { console.log(`${s.company.name}: ${s.seats} seats is a documented override — left alone`); continue; }
    if (used > target) { console.log(`${s.company.name}: ${used} users already — left at ${s.seats} (default would be ${target})`); continue; }
    console.log(`${s.company.name}: seats ${s.seats} -> ${target} (${used} in use)`);
    if (APPLY) await db.subscription.update({ where: { id: s.id }, data: { seats: target } });
  }
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
