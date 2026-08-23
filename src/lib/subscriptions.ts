/**
 * Subscription lifecycle — statuses, legal transitions and what each one means
 * for a client's access.
 *
 * Kept in `lib` rather than `server` because both portals render it and the
 * client-side confirmation dialogs need the labels; nothing here touches the
 * database.
 *
 * The transition table is the important part. Without it "mark past due" and
 * "restore" are just two writes to the same column, and a console operator can
 * walk a cancelled account back to trialing by accident.
 */

export const SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: "Trialing",
  ACTIVE: "Active",
  PAST_DUE: "Past due",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
};

export const SUBSCRIPTION_STATUS_DESCRIPTIONS: Record<SubscriptionStatus, string> = {
  TRIALING: "Inside a trial. Full access until the trial end date.",
  ACTIVE: "Paid and in good standing.",
  PAST_DUE: "Payment has failed or is late. Access continues during the grace period.",
  SUSPENDED: "Access withheld. The books stay readable and exportable.",
  CANCELLED: "Ended. The company file becomes read-only and is retained.",
};

/**
 * Which statuses may follow which. A transition absent from this table is
 * rejected server-side, not merely hidden in the UI.
 *
 * Notable deliberate omissions: nothing returns to TRIALING (a trial is a
 * beginning, and "give them more time" is a trial *extension*, which does not
 * change status), and CANCELLED reopens only to ACTIVE — restoring a cancelled
 * client is a commercial decision that should land them in a billable state.
 */
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIALING: ["ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"],
  ACTIVE: ["PAST_DUE", "SUSPENDED", "CANCELLED"],
  PAST_DUE: ["ACTIVE", "SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  CANCELLED: ["ACTIVE"],
};

export function canTransition(from: string, to: string): boolean {
  const source = SUBSCRIPTION_TRANSITIONS[from as SubscriptionStatus];
  return Array.isArray(source) && source.includes(to as SubscriptionStatus);
}

export function isSubscriptionStatus(value: string | null | undefined): value is SubscriptionStatus {
  return !!value && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

/** Transitions that must not happen without a typed reason. */
export const REASON_REQUIRED_STATUSES: SubscriptionStatus[] = ["SUSPENDED", "CANCELLED", "PAST_DUE"];

export function requiresReason(to: string): boolean {
  return REASON_REQUIRED_STATUSES.includes(to as SubscriptionStatus);
}

// ─────────────────────────────────────────────────────────────────────────────
// What a status means for access
// ─────────────────────────────────────────────────────────────────────────────

export interface AccessState {
  /** The company file may still be written to. */
  writable: boolean;
  /** Short phrase for the banner shown inside the client's app. */
  reason: string | null;
}

export interface AccessInput {
  status: string;
  trialEndsAt?: Date | string | null;
}

/**
 * The access rule, in one place.
 *
 * A lapsed subscription never destroys or hides anything: the books stay
 * readable and exportable, and only new postings are refused. That is a
 * deliberate product commitment — a customer's accounting records are theirs,
 * and holding them hostage over an unpaid invoice is not a lever this product
 * offers.
 */
export function accessFor(subscription: AccessInput | null | undefined): AccessState {
  if (!subscription) return { writable: true, reason: null };

  switch (subscription.status) {
    case "SUSPENDED":
      return { writable: false, reason: "This company file is suspended. It is read-only until access is restored." };
    case "CANCELLED":
      return { writable: false, reason: "This subscription has ended. The file is read-only and remains exportable." };
    case "TRIALING": {
      const ends = subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null;
      if (ends && ends.getTime() < Date.now()) {
        return { writable: false, reason: "The trial has ended. Choose a plan to continue posting." };
      }
      return { writable: true, reason: null };
    }
    // Past due keeps working on purpose — a failed card should not stop a
    // business invoicing its customers while it is being sorted out.
    case "PAST_DUE":
    case "ACTIVE":
    default:
      return { writable: true, reason: null };
  }
}

/** Statuses an operator should be looking at. Drives the dashboard's queue. */
export const ATTENTION_STATUSES: SubscriptionStatus[] = ["PAST_DUE", "SUSPENDED"];

export const STATUS_TONE: Record<SubscriptionStatus, "positive" | "caution" | "negative" | "neutral" | "info"> = {
  TRIALING: "info",
  ACTIVE: "positive",
  PAST_DUE: "caution",
  SUSPENDED: "negative",
  CANCELLED: "neutral",
};
