/**
 * Row census — what is actually in the database.
 *
 * Written to decide whether a database move needs a real data migration or can
 * simply re-run migrations and reseed. Read-only.
 */
import "./load-env";
import { db } from "../src/lib/db";

async function main() {
  const companies = await db.company.findMany({
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  for (const c of companies) {
    const where = { companyId: c.id };
    const [invoices, bills, payments, expenses, journals, lines, customers, vendors, members] =
      await Promise.all([
        db.invoice.count({ where }),
        db.bill.count({ where }),
        db.payment.count({ where }),
        db.expense.count({ where }),
        db.journalEntry.count({ where }),
        db.journalLine.count({ where }),
        db.customer.count({ where }),
        db.vendor.count({ where }),
        db.companyUser.findMany({
          where,
          select: { role: true, user: { select: { email: true, createdAt: true } } },
        }),
      ]);

    console.log(`\n=== ${c.name}  (created ${c.createdAt.toISOString().slice(0, 10)}) ===`);
    console.log(
      `invoices=${invoices} bills=${bills} payments=${payments} expenses=${expenses} ` +
        `journals=${journals} journalLines=${lines} customers=${customers} vendors=${vendors}`,
    );
    console.log("members:");
    for (const m of members) {
      console.log(
        `  ${m.role.padEnd(12)} ${m.user.email}  (user created ${m.user.createdAt
          .toISOString()
          .slice(0, 10)})`,
      );
    }
  }

  // Anything created after the seed date is post-seed activity worth knowing about.
  const cutoff = new Date("2026-08-11T00:00:00Z");
  console.log("\n=== rows created after 2026-08-11 (post-seed activity) ===");
  for (const [name, model] of [
    ["Invoice", db.invoice],
    ["Bill", db.bill],
    ["Payment", db.payment],
    ["Expense", db.expense],
    ["JournalEntry", db.journalEntry],
    ["Customer", db.customer],
    ["Vendor", db.vendor],
    ["Company", db.company],
    ["User", db.user],
  ] as Array<[string, { count: (a: unknown) => Promise<number> }]>) {
    const n = await model.count({ where: { createdAt: { gte: cutoff } } });
    if (n > 0) console.log(`  ${name.padEnd(14)} ${n}`);
  }

  const recentAudit = await db.auditLog.findMany({
    where: { createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { createdAt: true, action: true, entityType: true, summary: true },
  });
  console.log("\n=== last 10 audit entries after 2026-08-11 ===");
  for (const a of recentAudit) {
    console.log(`  ${a.createdAt.toISOString().slice(0, 16)}  ${a.action.padEnd(8)} ${a.entityType.padEnd(12)} ${a.summary ?? ""}`);
  }
  if (recentAudit.length === 0) console.log("  (none)");

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
