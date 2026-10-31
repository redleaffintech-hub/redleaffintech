import "server-only";
import type { Tx } from "@/lib/db";
import { EXTRA_USER_PRICE_CENTS } from "@/lib/seats";
import { formatMoney } from "@/lib/money";

/** A refusal written for the person who hit it, safe to show as-is. */
export class SeatLimitError extends Error {}

/**
 * Take the company's subscription row lock, then refuse if another person would
 * exceed the approved user limit.
 *
 * The lock matters: without it two simultaneous invites both count "1 seat left"
 * and both succeed. Everything that can ADD a person to a company (invite,
 * restoring a suspended user) runs this inside the same transaction as the write,
 * which is what makes the limit impossible to bypass from the company side.
 *
 * Seats are held by ACTIVE and INVITED memberships; a SUSPENDED one is free.
 */
export async function assertSeatAvailable(tx: Tx, companyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "companyId" = ${companyId} FOR UPDATE`;
  const subscription = await tx.subscription.findUnique({
    where: { companyId },
    select: { seats: true, extraSeatPriceCents: true },
  });
  if (!subscription) return; // no subscription row: nothing to enforce against (legacy/dev data)

  const used = await tx.companyUser.count({
    where: { companyId, status: { in: ["ACTIVE", "INVITED"] } },
  });
  if (used >= subscription.seats) {
    const price = formatMoney(subscription.extraSeatPriceCents ?? EXTRA_USER_PRICE_CENTS);
    throw new SeatLimitError(
      `This company is at its limit of ${subscription.seats} users. Request additional users (${price} each per month) — a platform administrator approves requests.`,
    );
  }
}
