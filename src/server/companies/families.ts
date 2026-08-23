import "server-only";

import { db, type Tx } from "@/lib/db";

/**
 * A subscription's company family.
 *
 * `Subscription.companyId` is the original, billing company — untouched by
 * this module, so every admin-portal screen that resolves "the subscription
 * for this company" keeps working exactly as it always has. Everything this
 * module adds sits beside that relationship rather than inside it:
 * `SubscriptionCompany` rows are the companies a Primary attached afterwards
 * through self-service.
 *
 * The distinction that matters everywhere below is ARCHIVED vs not. An
 * archived company still belongs to the family (its history has to stay
 * attributable to the right subscription) but does not count against the
 * plan's company limit and cannot be switched into.
 */

export interface FamilyCompany {
  id: string;
  name: string;
  legalName: string | null;
  province: string;
  baseCurrency: string;
  createdAt: Date;
  archivedAt: Date | null;
  archiveReason: string | null;
  isOriginal: boolean;
  /** Whether the acting user has an active membership — see companies/page.tsx. */
  memberRole: string | null;
}

export interface CompanyLimit {
  used: number;
  limit: number;
  overLimit: boolean;
  planName: string | null;
}

/** The subscription that owns a company, whichever side of the relationship it's on. */
export async function subscriptionForCompany(companyId: string) {
  const direct = await db.subscription.findUnique({ where: { companyId } });
  if (direct) return direct;
  const joined = await db.subscriptionCompany.findUnique({
    where: { companyId },
    select: { subscription: true },
  });
  return joined?.subscription ?? null;
}

/** Every company in a subscription's family, original first. */
export async function companyFamily(subscriptionId: string, forUserId?: string): Promise<FamilyCompany[]> {
  const subscription = await db.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    select: { companyId: true },
  });

  const [original, joined, memberships] = await Promise.all([
    db.company.findUnique({
      where: { id: subscription.companyId },
      select: {
        id: true, name: true, legalName: true, province: true, baseCurrency: true,
        createdAt: true, archivedAt: true, archiveReason: true,
      },
    }),
    db.subscriptionCompany.findMany({
      where: { subscriptionId },
      include: {
        company: {
          select: {
            id: true, name: true, legalName: true, province: true, baseCurrency: true,
            createdAt: true, archivedAt: true, archiveReason: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    forUserId
      ? db.companyUser.findMany({
          where: { userId: forUserId, status: "ACTIVE" },
          select: { companyId: true, role: true },
        })
      : Promise.resolve([]),
  ]);

  const roleByCompany = new Map(memberships.map((m) => [m.companyId, m.role]));
  const rows: FamilyCompany[] = [];
  if (original) {
    rows.push({ ...original, isOriginal: true, memberRole: roleByCompany.get(original.id) ?? null });
  }
  for (const j of joined) {
    rows.push({ ...j.company, isOriginal: false, memberRole: roleByCompany.get(j.company.id) ?? null });
  }
  return rows;
}

/** Non-archived company count against the subscription's plan limit. */
export async function companyLimit(
  subscriptionId: string,
  client: Tx | typeof db = db,
): Promise<CompanyLimit> {
  const subscription = await client.subscription.findUniqueOrThrow({
    where: { id: subscriptionId },
    select: { companyId: true, planRecord: { select: { companies: true, name: true } } },
  });

  const [originalArchived, joinedActive] = await Promise.all([
    client.company.findUnique({ where: { id: subscription.companyId }, select: { archivedAt: true } }),
    client.subscriptionCompany.count({
      where: { subscriptionId, company: { archivedAt: null } },
    }),
  ]);

  const used = (originalArchived && !originalArchived.archivedAt ? 1 : 0) + joinedActive;
  // A subscription with no plan resolved (catalogue not yet published, or a
  // seat granted directly) gets the conservative floor of 1 rather than an
  // unbounded limit — silently unlimited is not a safe default for billing.
  const limit = subscription.planRecord?.companies ?? 1;

  return { used, limit, overLimit: used > limit, planName: subscription.planRecord?.name ?? null };
}

/**
 * Serialize concurrent limit checks for one subscription.
 *
 * `SELECT ... FOR UPDATE` takes a row lock on the Subscription row for the
 * life of the caller's transaction. A second "add company" transaction on the
 * same subscription blocks here until the first commits or rolls back, so its
 * own count-then-create sees the first one's result rather than a stale count
 * — that is what stops two simultaneous requests both reading "9 of 10 used"
 * and both succeeding. Transactions on a DIFFERENT subscription are unaffected.
 */
export async function lockSubscriptionForCompanyChange(tx: Tx, subscriptionId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${subscriptionId} FOR UPDATE`;
}

/** Attach a company to a subscription's family. Call after acquiring the lock above. */
export async function attachCompanyToSubscription(
  tx: Tx,
  subscriptionId: string,
  companyId: string,
  addedById: string,
): Promise<void> {
  await tx.subscriptionCompany.create({
    data: { subscriptionId, companyId, addedById },
  });
}
