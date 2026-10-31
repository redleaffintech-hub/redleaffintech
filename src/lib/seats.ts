/**
 * User allowance and the price of going beyond it. Pure and client-safe: the same
 * numbers drive the request form's live total and the server-side record.
 */

/** Users every company gets in its subscription: the owner/admin and one accountant. */
export const INCLUDED_USERS = 2;

/** Per additional user, per month, in cents. Frozen onto each request and subscription when granted. */
export const EXTRA_USER_PRICE_CENTS = 499;

/** One request may ask for at most this many; larger teams talk to support. */
export const MAX_EXTRA_USERS_PER_REQUEST = 25;

export function extraChargeCents(extraUsers: number, unitPriceCents: number = EXTRA_USER_PRICE_CENTS): number {
  return extraUsers * unitPriceCents;
}

export const SEAT_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
