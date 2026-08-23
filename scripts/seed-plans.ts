/**
 * Seed the plan catalogue and migrate existing subscriptions onto it.
 * `npm run plans:seed`
 *
 * Idempotent and non-destructive by design, because this runs against a live
 * database:
 *
 *   * A plan whose code already exists is left completely alone — including its
 *     prices. Re-running this after an administrator has edited the Professional
 *     plan must not quietly reinstate the placeholder price.
 *   * Each newly seeded plan is published as version 1, so the public pricing
 *     page has something to render immediately.
 *   * Existing `Subscription` rows are linked to their plan by code and given
 *     the price snapshot they were missing. Rows that already carry a `planId`
 *     are skipped: whatever they hold was agreed with a customer.
 *
 * Nothing is ever deleted, and no company, user, membership or subscription is
 * modified beyond filling in the new columns.
 */

import "./load-env"; // must precede any import that reads process.env
import { db } from "../src/lib/db";
import { BILLING_CYCLES, CYCLE_MONTHS, type BillingCycle } from "../src/lib/plans";
import { SEED_PLANS, seedCycleAmountCents } from "../src/server/plans/seed-data";
import { planShapeFromRow, serializeSnapshot, PLAN_INCLUDE } from "../src/server/plans/catalogue";

async function seedPlans() {
  let created = 0;
  let skipped = 0;

  for (const seed of SEED_PLANS) {
    const existing = await db.plan.findUnique({ where: { code: seed.code }, select: { id: true } });
    if (existing) {
      skipped += 1;
      console.log(`  · ${seed.code} already exists — left untouched`);
      continue;
    }

    await db.$transaction(async (tx) => {
      const plan = await tx.plan.create({
        data: {
          code: seed.code,
          name: seed.name,
          description: seed.description,
          forWhom: seed.forWhom,
          currency: seed.currency,
          seats: seed.seats,
          companies: seed.companies,
          storageGb: seed.storageGb,
          support: seed.support,
          sortOrder: seed.sortOrder,
          isPopular: Boolean(seed.popular),
          contactOnly: Boolean(seed.contactOnly),
          isPublic: true,
          status: "DRAFT",
          hasDraftChanges: true,
        },
      });

      await tx.planPrice.createMany({
        data: BILLING_CYCLES.map((cycle) => ({
          planId: plan.id,
          cycle,
          cycleAmountCents: seedCycleAmountCents(seed, cycle),
          monthlyEquivalentCents: seed.monthlyEquivalentCents[cycle],
        })),
      });

      await tx.planFeature.createMany({
        data: seed.includes.map((label, index) => ({ planId: plan.id, label, sortOrder: index * 10 })),
      });

      await tx.planModule.createMany({
        data: seed.modules.map((moduleId) => ({ planId: plan.id, moduleId })),
      });

      // Publish version 1 so the public pricing page is not blank the moment
      // the hard-coded array stops being read.
      const full = await tx.plan.findUniqueOrThrow({ where: { id: plan.id }, include: PLAN_INCLUDE });
      const version = await tx.planVersion.create({
        data: {
          planId: plan.id,
          version: 1,
          snapshot: serializeSnapshot(planShapeFromRow(full)),
        },
      });
      await tx.plan.update({
        where: { id: plan.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          publishedVersionId: version.id,
          hasDraftChanges: false,
        },
      });
    });

    created += 1;
    console.log(`  ✓ ${seed.code} created and published as version 1`);
  }

  return { created, skipped };
}

/**
 * Give existing subscriptions their plan link and price snapshot.
 *
 * The old rows carry only a plan *code* and a seat count. Everything else — the
 * billing cycle, the currency, the agreed price — has to be inferred, and the
 * only defensible inference is the published price of the plan they are on, on
 * the monthly cycle they were implicitly sold at.
 */
async function linkSubscriptions() {
  const unlinked = await db.subscription.findMany({
    where: { planId: null },
    select: { id: true, plan: true, seats: true, billingCycle: true, companyId: true },
  });
  if (unlinked.length === 0) return { linked: 0, orphaned: [] as string[] };

  const plans = await db.plan.findMany({
    where: { publishedVersionId: { not: null } },
    include: PLAN_INCLUDE,
  });
  const byCode = new Map(plans.map((plan) => [plan.code, plan]));

  let linked = 0;
  const orphaned: string[] = [];

  for (const subscription of unlinked) {
    const plan = byCode.get(subscription.plan);
    if (!plan) {
      // A code with no matching plan is left exactly as it is: guessing which
      // plan a paying customer meant is not this script's decision to make.
      orphaned.push(`${subscription.id} (plan "${subscription.plan}")`);
      continue;
    }

    const cycle = (BILLING_CYCLES as readonly string[]).includes(subscription.billingCycle)
      ? (subscription.billingCycle as BillingCycle)
      : "MONTHLY";
    const price = plan.prices.find((row) => row.cycle === cycle);

    await db.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: plan.id,
        planVersionId: plan.publishedVersionId,
        billingCycle: cycle,
        currency: plan.currency,
        priceCents: price?.cycleAmountCents ?? null,
        monthlyEquivalentCents: price?.monthlyEquivalentCents ?? null,
        // The seat allowance already on the row wins: it may be a negotiated
        // number, and overwriting it with the plan default could evict someone.
        seatsOverridden: subscription.seats !== plan.seats,
      },
    });
    linked += 1;
  }

  return { linked, orphaned };
}

async function main() {
  console.log("Seeding the plan catalogue…");
  const { created, skipped } = await seedPlans();

  console.log("\nLinking existing subscriptions…");
  const { linked, orphaned } = await linkSubscriptions();
  console.log(`  ✓ ${linked} subscription${linked === 1 ? "" : "s"} linked to a plan`);
  if (orphaned.length > 0) {
    console.log(`  ! ${orphaned.length} left unlinked — no plan matches their code:`);
    for (const entry of orphaned) console.log(`      ${entry}`);
  }

  const published = await db.plan.count({ where: { status: "PUBLISHED", isPublic: true } });
  console.log(
    `\nDone. ${created} plan${created === 1 ? "" : "s"} created, ${skipped} left untouched, ${published} published and public.`,
  );
  console.log(`Cycle lengths in months: ${JSON.stringify(CYCLE_MONTHS)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
