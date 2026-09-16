/**
 * One-off backfill: allocate a display code (issue 9, 15 Sep 2026 review) to
 * every existing customer that doesn't have one yet.
 *
 * Deterministic ordering: customers are coded in `createdAt ASC, id ASC`
 * order per company — the closest available proxy for "the order they were
 * added in" (no other historical ordering signal exists on the row). This is
 * documented rather than guessed at: it is NOT necessarily the order
 * customers were originally entered if createdAt was ever backfilled itself,
 * but it is the only stable, reproducible ordering available.
 *
 * Idempotent and safe to re-run — skips any customer that already has a
 * displayCode, and never renumbers one that's already set. Continues each
 * company's sequence from its current `nextCustomerCodeNumber`, so a
 * backfill run after some customers were already created the normal way
 * does not collide with codes already issued.
 *
 * Defaults to a DRY RUN that only prints the mapping. Pass --apply to write
 * it. Never run --apply against production without the user's explicit
 * go-ahead — see the 15 Sep 2026 review completion notes.
 *
 * `DATABASE_URL=... DATABASE_URL_UNPOOLED=... npx tsx scripts/backfill-customer-codes.ts [--apply] [--company <id>]`
 */
import "./load-env";
import { db } from "../src/lib/db";
import { nextCustomerCode } from "../src/server/documents/numbering";

async function main() {
  const apply = process.argv.includes("--apply");
  const companyArgIndex = process.argv.indexOf("--company");
  const onlyCompanyId = companyArgIndex !== -1 ? process.argv[companyArgIndex + 1] : undefined;

  const companies = await db.company.findMany({
    where: onlyCompanyId ? { id: onlyCompanyId } : undefined,
    select: { id: true, name: true },
  });

  let totalAssigned = 0;

  for (const company of companies) {
    const customers = await db.customer.findMany({
      where: { companyId: company.id, displayCode: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, createdAt: true },
    });
    if (customers.length === 0) continue;

    console.log(`\n${company.name} (${company.id}) — ${customers.length} customer(s) without a code:`);

    if (!apply) {
      // Preview only: peek the sequence forward without consuming it, so a
      // dry run can be inspected and re-run freely.
      const start = await db.company.findUniqueOrThrow({
        where: { id: company.id },
        select: { customerCodePrefix: true, customerCodePadding: true, nextCustomerCodeNumber: true },
      });
      let next = start.nextCustomerCodeNumber;
      for (const customer of customers) {
        const code = `${start.customerCodePrefix}${String(next).padStart(start.customerCodePadding, "0")}`;
        console.log(`  [dry run] ${customer.name} (${customer.id}, created ${customer.createdAt.toISOString().slice(0, 10)}) -> ${code}`);
        next++;
      }
      continue;
    }

    await db.$transaction(async (tx) => {
      for (const customer of customers) {
        const code = await nextCustomerCode(tx, company.id);
        await tx.customer.update({ where: { id: customer.id }, data: { displayCode: code } });
        console.log(`  ${customer.name} (${customer.id}) -> ${code}`);
        totalAssigned++;
      }
    });
  }

  console.log(
    apply
      ? `\nDone. ${totalAssigned} customer(s) assigned a display code.`
      : `\nDry run only — no changes written. Re-run with --apply to write these codes.`,
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
