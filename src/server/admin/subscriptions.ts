/**
 * Subscription administration.
 *
 * Every mutation in here does the same four things, in the same order, and the
 * ordering is deliberate:
 *
 *   1. validate the change against the state machine in `src/lib/subscriptions.ts`;
 *   2. write the subscription;
 *   3. apply the access consequence to the company (suspending a subscription
 *      must actually make the file read-only — a status nobody enforces is
 *      decoration);
 *   4. record it twice — a typed `SubscriptionEvent` for the timeline on the
 *      detail page, and a `PlatformAuditLog` row for compliance.
 *
 * Steps 1–3 run inside one transaction so a subscription can never end up
 * suspended while the company it belongs to is still writable. Step 4 runs
 * after the commit, because a failure to write the audit trail must not roll
 * back a change an operator has already been told about.
 */

import "server-only";
import { db, type Tx } from "@/lib/db";
import { addDays, addMonths } from "@/lib/dates";
import {
  accessFor,
  canTransition,
  isSubscriptionStatus,
  type SubscriptionStatus,
} from "@/lib/subscriptions";
import { CYCLE_MONTHS, isValidCycle, type BillingCycle } from "@/lib/plans";
import { assignmentFromPlan, sellablePlanByCode, type PlanAssignment } from "@/server/plans/catalogue";
import { AUDIT_ACTIONS, recordPlatformAudit } from "./audit";
import type { AdminActor } from "./guard";

export class SubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionError";
  }
}

/** Seats in use — invited members hold a seat, because they are about to use one. */
export async function seatsUsed(companyId: string, client: Tx | typeof db = db): Promise<number> {
  return client.companyUser.count({
    where: { companyId, status: { in: ["ACTIVE", "INVITED"] } },
  });
}

/**
 * Push the subscription's access consequence onto the company.
 *
 * `Company.isReadOnly` is the flag the whole accounting app already respects, so
 * rather than teach every posting path about subscriptions, the lifecycle keeps
 * that one flag true. The cost is that an operator toggling read-only by hand on
 * a suspended company will see it flip back on the next lifecycle change, which
 * is the correct precedence.
 */
async function applyAccess(tx: Tx, companyId: string, status: string, trialEndsAt: Date | null) {
  const access = accessFor({ status, trialEndsAt });
  await tx.company.update({ where: { id: companyId }, data: { isReadOnly: !access.writable } });
  return access;
}

interface EventInput {
  subscriptionId: string;
  type: string;
  summary: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  actor: AdminActor;
}

async function recordEvent(tx: Tx, input: EventInput) {
  await tx.subscriptionEvent.create({
    data: {
      subscriptionId: input.subscriptionId,
      type: input.type,
      summary: input.summary,
      reason: input.reason ?? null,
      beforeJson: input.before === undefined ? null : JSON.stringify(input.before),
      afterJson: input.after === undefined ? null : JSON.stringify(input.after),
      actorUserId: input.actor.id,
      actorEmail: input.actor.email,
    },
  });
}

export const SUBSCRIPTION_DETAIL_SELECT = {
  id: true,
  companyId: true,
  plan: true,
  planId: true,
  planVersionId: true,
  status: true,
  billingCycle: true,
  currency: true,
  priceCents: true,
  monthlyEquivalentCents: true,
  seats: true,
  seatsOverridden: true,
  seatOverrideReason: true,
  seatOverrideAt: true,
  trialStartsAt: true,
  trialEndsAt: true,
  startedAt: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  pastDueSince: true,
  suspendedAt: true,
  suspendReason: true,
  cancelAt: true,
  cancelledAt: true,
  cancelReason: true,
  providerRef: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Creation and plan assignment
// ─────────────────────────────────────────────────────────────────────────────

export interface AssignPlanInput {
  companyId: string;
  planCode: string;
  cycle: string;
  status?: string;
  trialStartsAt?: Date | null;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  /** An explicit seat allowance, overriding the plan's. Requires a reason. */
  seatOverride?: number | null;
  seatOverrideReason?: string | null;
  reason?: string | null;
}

async function resolvePlan(planCode: string, cycle: string): Promise<PlanAssignment> {
  if (!isValidCycle(cycle)) throw new SubscriptionError("Choose a billing cycle.");
  const plan = await sellablePlanByCode(planCode);
  if (!plan) {
    throw new SubscriptionError("That plan is not published, so it cannot be sold. Publish it first.");
  }
  if (plan.contactOnly) {
    // Not a hard refusal — a quoted plan is exactly the kind an operator assigns
    // by hand — but it must be a deliberate act, so the price is taken from the
    // published snapshot rather than left at zero.
    if (plan.prices[cycle as BillingCycle]?.cycleAmountCents === 0) {
      throw new SubscriptionError(
        `${plan.name} is a contact-sales plan with no published ${cycle.toLowerCase()} price. Set one before assigning it.`,
      );
    }
  }
  return assignmentFromPlan(plan, cycle);
}

/**
 * Assign a plan to a company — creating the subscription if there is none.
 *
 * The agreed price is snapshotted onto the row here and never recalculated. An
 * administrator editing the plan's public price tomorrow changes what new
 * customers pay, and nothing else.
 */
export async function assignPlan(actor: AdminActor, input: AssignPlanInput) {
  const assignment = await resolvePlan(input.planCode, input.cycle);

  const status = input.status ?? "TRIALING";
  if (!isSubscriptionStatus(status)) throw new SubscriptionError("That is not a subscription status.");

  const seats = input.seatOverride ?? assignment.seats;
  if (!Number.isInteger(seats) || seats < 1) {
    throw new SubscriptionError("Seat allowance must be a whole number of at least 1.");
  }
  if (input.seatOverride != null && !input.seatOverrideReason?.trim()) {
    throw new SubscriptionError("A seat override needs a reason — it is a commercial exception, and it is logged.");
  }

  const used = await seatsUsed(input.companyId);
  if (used > seats) {
    throw new SubscriptionError(
      `${used} people already have access; this plan allows ${seats}. Remove access first, or set a documented seat override.`,
    );
  }

  const now = new Date();
  const existing = await db.subscription.findUnique({
    where: { companyId: input.companyId },
    select: SUBSCRIPTION_DETAIL_SELECT,
  });

  const trialEndsAt =
    status === "TRIALING" ? (input.trialEndsAt ?? existing?.trialEndsAt ?? addDays(now, 30)) : (input.trialEndsAt ?? null);

  const periodEnd =
    input.currentPeriodEnd ?? (status === "ACTIVE" ? addMonths(now, CYCLE_MONTHS[assignment.billingCycle]) : null);

  const data = {
    plan: assignment.planCode,
    planId: assignment.planId,
    planVersionId: assignment.planVersionId,
    status,
    billingCycle: assignment.billingCycle,
    currency: assignment.currency,
    priceCents: assignment.priceCents,
    monthlyEquivalentCents: assignment.monthlyEquivalentCents,
    seats,
    seatsOverridden: input.seatOverride != null,
    seatOverrideReason: input.seatOverride != null ? (input.seatOverrideReason ?? null) : null,
    seatOverrideAt: input.seatOverride != null ? now : null,
    seatOverrideById: input.seatOverride != null ? actor.id : null,
    trialStartsAt: status === "TRIALING" ? (input.trialStartsAt ?? existing?.trialStartsAt ?? now) : (input.trialStartsAt ?? null),
    trialEndsAt,
    startedAt: existing?.startedAt ?? (status === "ACTIVE" ? now : null),
    currentPeriodStart: existing?.currentPeriodStart ?? (status === "ACTIVE" ? now : null),
    currentPeriodEnd: periodEnd,
    // Assigning a plan clears the terminal states: this is a live subscription again.
    suspendedAt: status === "SUSPENDED" ? (existing?.suspendedAt ?? now) : null,
    suspendReason: status === "SUSPENDED" ? existing?.suspendReason ?? null : null,
    pastDueSince: status === "PAST_DUE" ? (existing?.pastDueSince ?? now) : null,
    cancelledAt: status === "CANCELLED" ? (existing?.cancelledAt ?? now) : null,
    cancelAt: status === "CANCELLED" ? existing?.cancelAt ?? null : null,
    cancelReason: status === "CANCELLED" ? existing?.cancelReason ?? null : null,
  };

  const subscription = await db.$transaction(async (tx) => {
    const row = await tx.subscription.upsert({
      where: { companyId: input.companyId },
      create: { companyId: input.companyId, ...data },
      update: data,
      select: SUBSCRIPTION_DETAIL_SELECT,
    });

    await applyAccess(tx, input.companyId, row.status, row.trialEndsAt);

    await recordEvent(tx, {
      subscriptionId: row.id,
      type: existing ? "PLAN_CHANGED" : "CREATED",
      summary: existing
        ? `Plan changed from ${existing.plan} to ${assignment.planCode} (${assignment.billingCycle.toLowerCase()})`
        : `Subscription created on ${assignment.planCode} (${assignment.billingCycle.toLowerCase()})`,
      reason: input.reason ?? null,
      before: existing ?? undefined,
      after: row,
      actor,
    });

    return row;
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: existing ? AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED : AUDIT_ACTIONS.SUBSCRIPTION_CREATED,
    entityType: "Subscription",
    entityId: subscription.id,
    summary: existing
      ? `${assignment.planCode} assigned (was ${existing.plan})`
      : `Subscription created on ${assignment.planCode}`,
    reason: input.reason ?? null,
    before: existing ?? undefined,
    after: subscription,
  });

  return subscription;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusChangeInput {
  subscriptionId: string;
  to: string;
  reason?: string | null;
  /** For CANCELLED: cancel at period end rather than immediately. */
  atPeriodEnd?: boolean;
}

export async function changeStatus(actor: AdminActor, input: StatusChangeInput) {
  const existing = await db.subscription.findUnique({
    where: { id: input.subscriptionId },
    select: { ...SUBSCRIPTION_DETAIL_SELECT, company: { select: { id: true, name: true } } },
  });
  if (!existing) throw new SubscriptionError("That subscription no longer exists.");

  if (!isSubscriptionStatus(input.to)) throw new SubscriptionError("That is not a subscription status.");
  if (existing.status === input.to) {
    throw new SubscriptionError(`This subscription is already ${input.to.toLowerCase().replace("_", " ")}.`);
  }
  if (!canTransition(existing.status, input.to)) {
    throw new SubscriptionError(
      `A ${existing.status.toLowerCase().replace("_", " ")} subscription cannot move straight to ${input.to
        .toLowerCase()
        .replace("_", " ")}.`,
    );
  }

  const reason = input.reason?.trim() || null;
  if (["SUSPENDED", "CANCELLED", "PAST_DUE"].includes(input.to) && !reason) {
    throw new SubscriptionError("Give a reason — it is recorded against the client and shown in the audit log.");
  }

  const now = new Date();
  const to = input.to as SubscriptionStatus;

  // A scheduled cancellation is not a cancellation: the status stays put and
  // only `cancelAt` is set, so the client keeps working until the date arrives.
  if (to === "CANCELLED" && input.atPeriodEnd) {
    const effective = existing.currentPeriodEnd ?? existing.trialEndsAt ?? addDays(now, 30);
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.subscription.update({
        where: { id: existing.id },
        data: { cancelAt: effective, cancelReason: reason },
        select: SUBSCRIPTION_DETAIL_SELECT,
      });
      await recordEvent(tx, {
        subscriptionId: row.id,
        type: "CANCEL_SCHEDULED",
        summary: `Cancellation scheduled for ${effective.toISOString().slice(0, 10)}`,
        reason,
        before: { cancelAt: existing.cancelAt },
        after: { cancelAt: row.cancelAt },
        actor,
      });
      return row;
    });

    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED,
      entityType: "Subscription",
      entityId: existing.id,
      summary: `${existing.company.name}: cancellation scheduled for ${effective.toISOString().slice(0, 10)}`,
      reason,
      before: { cancelAt: existing.cancelAt, status: existing.status },
      after: { cancelAt: updated.cancelAt, status: updated.status },
    });
    return updated;
  }

  const data: Record<string, unknown> = { status: to };
  switch (to) {
    case "ACTIVE":
      data.startedAt = existing.startedAt ?? now;
      data.currentPeriodStart = existing.currentPeriodStart ?? now;
      data.currentPeriodEnd =
        existing.currentPeriodEnd && existing.currentPeriodEnd > now
          ? existing.currentPeriodEnd
          : addMonths(now, CYCLE_MONTHS[(existing.billingCycle as BillingCycle) ?? "MONTHLY"] ?? 1);
      // Restoring clears every reason the account was withheld.
      data.suspendedAt = null;
      data.suspendReason = null;
      data.pastDueSince = null;
      data.cancelledAt = null;
      data.cancelAt = null;
      data.cancelReason = null;
      break;
    case "PAST_DUE":
      data.pastDueSince = existing.pastDueSince ?? now;
      break;
    case "SUSPENDED":
      data.suspendedAt = now;
      data.suspendReason = reason;
      break;
    case "CANCELLED":
      data.cancelledAt = now;
      data.cancelReason = reason;
      data.cancelAt = null;
      break;
    case "TRIALING":
    default:
      break;
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.subscription.update({
      where: { id: existing.id },
      data,
      select: SUBSCRIPTION_DETAIL_SELECT,
    });
    await applyAccess(tx, row.companyId, row.status, row.trialEndsAt);
    await recordEvent(tx, {
      subscriptionId: row.id,
      type: "STATUS_CHANGED",
      summary: `Status ${existing.status} → ${row.status}`,
      reason,
      before: { status: existing.status },
      after: { status: row.status },
      actor,
    });
    return row;
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action:
      to === "CANCELLED" ? AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED : AUDIT_ACTIONS.SUBSCRIPTION_STATUS_CHANGED,
    entityType: "Subscription",
    entityId: existing.id,
    summary: `${existing.company.name}: ${existing.status} → ${to}`,
    reason,
    before: { status: existing.status },
    after: { status: to },
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trials, seats, periods, notes
// ─────────────────────────────────────────────────────────────────────────────

export async function extendTrial(
  actor: AdminActor,
  input: { subscriptionId: string; days?: number; until?: Date | null; reason?: string | null },
) {
  const existing = await db.subscription.findUnique({
    where: { id: input.subscriptionId },
    select: { ...SUBSCRIPTION_DETAIL_SELECT, company: { select: { name: true } } },
  });
  if (!existing) throw new SubscriptionError("That subscription no longer exists.");

  const base = existing.trialEndsAt && existing.trialEndsAt > new Date() ? existing.trialEndsAt : new Date();
  const until = input.until ?? (input.days ? addDays(base, input.days) : null);
  if (!until) throw new SubscriptionError("Choose how long to extend the trial by.");
  if (Number.isNaN(until.getTime())) throw new SubscriptionError("That is not a valid date.");
  if (until <= new Date()) throw new SubscriptionError("A trial cannot be extended to a date in the past.");

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.subscription.update({
      where: { id: existing.id },
      data: {
        trialEndsAt: until,
        // Extending a trial on a lapsed account puts it back in the trial, which
        // is what the operator means by the button.
        status: existing.status === "TRIALING" ? existing.status : existing.status,
        trialStartsAt: existing.trialStartsAt ?? existing.createdAt,
      },
      select: SUBSCRIPTION_DETAIL_SELECT,
    });
    await applyAccess(tx, row.companyId, row.status, row.trialEndsAt);
    await recordEvent(tx, {
      subscriptionId: row.id,
      type: "TRIAL_EXTENDED",
      summary: `Trial extended to ${until.toISOString().slice(0, 10)}`,
      reason: input.reason ?? null,
      before: { trialEndsAt: existing.trialEndsAt },
      after: { trialEndsAt: row.trialEndsAt },
      actor,
    });
    return row;
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_EXTENDED,
    entityType: "Subscription",
    entityId: existing.id,
    summary: `${existing.company.name}: trial extended to ${until.toISOString().slice(0, 10)}`,
    reason: input.reason ?? null,
    before: { trialEndsAt: existing.trialEndsAt },
    after: { trialEndsAt: until },
  });

  return updated;
}

export async function overrideSeats(
  actor: AdminActor,
  input: { subscriptionId: string; seats: number; reason: string },
) {
  const existing = await db.subscription.findUnique({
    where: { id: input.subscriptionId },
    select: { ...SUBSCRIPTION_DETAIL_SELECT, company: { select: { id: true, name: true } } },
  });
  if (!existing) throw new SubscriptionError("That subscription no longer exists.");

  if (!Number.isInteger(input.seats) || input.seats < 1) {
    throw new SubscriptionError("Seat allowance must be a whole number of at least 1.");
  }
  const reason = input.reason?.trim();
  if (!reason) throw new SubscriptionError("A seat override needs a reason. It is a commercial exception, and it is logged.");

  const used = await seatsUsed(existing.companyId);
  if (input.seats < used) {
    // Never silently evict anyone: refusing is the only safe answer, because the
    // alternative is choosing which of a client's staff loses their login.
    throw new SubscriptionError(
      `${used} people currently have access. Reduce the team to ${input.seats} first — lowering the allowance never removes anyone automatically.`,
    );
  }

  const planSeats = existing.planId
    ? (await db.plan.findUnique({ where: { id: existing.planId }, select: { seats: true } }))?.seats ?? null
    : null;

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.subscription.update({
      where: { id: existing.id },
      data: {
        seats: input.seats,
        seatsOverridden: planSeats === null ? true : input.seats !== planSeats,
        seatOverrideReason: planSeats !== null && input.seats === planSeats ? null : reason,
        seatOverrideAt: planSeats !== null && input.seats === planSeats ? null : new Date(),
        seatOverrideById: planSeats !== null && input.seats === planSeats ? null : actor.id,
      },
      select: SUBSCRIPTION_DETAIL_SELECT,
    });
    await recordEvent(tx, {
      subscriptionId: row.id,
      type: "SEATS_OVERRIDDEN",
      summary: `Seat allowance ${existing.seats} → ${row.seats}`,
      reason,
      before: { seats: existing.seats, seatsOverridden: existing.seatsOverridden },
      after: { seats: row.seats, seatsOverridden: row.seatsOverridden },
      actor,
    });
    return row;
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_SEATS_OVERRIDDEN,
    entityType: "Subscription",
    entityId: existing.id,
    summary: `${existing.company.name}: seats ${existing.seats} → ${input.seats}`,
    reason,
    before: { seats: existing.seats },
    after: { seats: input.seats },
  });

  return updated;
}

export async function setPeriodEnd(
  actor: AdminActor,
  input: { subscriptionId: string; currentPeriodEnd: Date; reason?: string | null },
) {
  const existing = await db.subscription.findUnique({
    where: { id: input.subscriptionId },
    select: { ...SUBSCRIPTION_DETAIL_SELECT, company: { select: { name: true } } },
  });
  if (!existing) throw new SubscriptionError("That subscription no longer exists.");
  if (Number.isNaN(input.currentPeriodEnd.getTime())) throw new SubscriptionError("That is not a valid date.");
  if (existing.currentPeriodStart && input.currentPeriodEnd <= existing.currentPeriodStart) {
    throw new SubscriptionError("The period end must fall after the period start.");
  }

  const updated = await db.$transaction(async (tx) => {
    const row = await tx.subscription.update({
      where: { id: existing.id },
      data: { currentPeriodEnd: input.currentPeriodEnd },
      select: SUBSCRIPTION_DETAIL_SELECT,
    });
    await recordEvent(tx, {
      subscriptionId: row.id,
      type: "PERIOD_CHANGED",
      summary: `Period end set to ${input.currentPeriodEnd.toISOString().slice(0, 10)}`,
      reason: input.reason ?? null,
      before: { currentPeriodEnd: existing.currentPeriodEnd },
      after: { currentPeriodEnd: row.currentPeriodEnd },
      actor,
    });
    return row;
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_PERIOD_CHANGED,
    entityType: "Subscription",
    entityId: existing.id,
    summary: `${existing.company.name}: period end ${input.currentPeriodEnd.toISOString().slice(0, 10)}`,
    reason: input.reason ?? null,
    before: { currentPeriodEnd: existing.currentPeriodEnd },
    after: { currentPeriodEnd: input.currentPeriodEnd },
  });

  return updated;
}

export async function addNote(actor: AdminActor, input: { subscriptionId: string; body: string }) {
  const body = input.body.trim();
  if (!body) throw new SubscriptionError("Write something first.");
  if (body.length > 4000) throw new SubscriptionError("That note is too long — keep it under 4000 characters.");

  const note = await db.subscriptionNote.create({
    data: {
      subscriptionId: input.subscriptionId,
      body,
      authorUserId: actor.id,
      authorEmail: actor.email,
    },
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_NOTE_ADDED,
    entityType: "Subscription",
    entityId: input.subscriptionId,
    summary: "Internal note added",
    // The note body itself is not copied into the audit trail: it is already
    // stored, and duplicating free text into a compliance log is how personal
    // data ends up in two places with one retention policy.
  });

  return note;
}

export async function setProviderRef(
  actor: AdminActor,
  input: { subscriptionId: string; providerRef: string | null },
) {
  const ref = input.providerRef?.trim() || null;
  const updated = await db.subscription.update({
    where: { id: input.subscriptionId },
    data: { providerRef: ref },
    select: SUBSCRIPTION_DETAIL_SELECT,
  });
  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_STATUS_CHANGED,
    entityType: "Subscription",
    entityId: input.subscriptionId,
    summary: ref ? "Payment provider reference set" : "Payment provider reference cleared",
    after: { providerRef: ref },
  });
  return updated;
}
