/**
 * Subscription administration.
 *
 * Every mutation: validate against the state machine (src/lib/subscriptions.ts),
 * write the subscription, push the access consequence onto `Company.isReadOnly`
 * (a status nobody enforces is decoration), then record it twice — a typed
 * `subscriptionEvents` doc for the timeline and a `platformAuditLogs` row.
 *
 * DEVIATION: Firestore has no cross-collection transaction, so the write +
 * access-consequence + event now run in sequence rather than atomically. The
 * access flip follows the subscription write immediately; a crash between them
 * leaves a subscription whose status is ahead of the company flag, which the
 * next lifecycle change corrects.
 */

import "server-only";
import { addDays, addMonths } from "@/lib/dates";
import {
  accessFor,
  canTransition,
  isSubscriptionStatus,
  type SubscriptionStatus,
} from "@/lib/subscriptions";
import { CYCLE_MONTHS, isValidCycle, type BillingCycle } from "@/lib/plans";
import { assignmentFromPlan, sellablePlanByCode, type PlanAssignment } from "@/server/plans/catalogue";
import { getCompany, updateCompany } from "@/server/db/companies";
import { listMembershipsForCompany } from "@/server/db/company-users";
import {
  addSubscriptionEvent,
  addSubscriptionNote,
  getSubscriptionForCompany,
  plans as plansRepo,
  subscriptions as subsRepo,
} from "@/server/db/platform";
import { newId } from "@/server/db/firestore";
import type { Subscription } from "@/server/db/types";
import { AUDIT_ACTIONS, recordPlatformAudit } from "./audit";
import type { AdminActor } from "./guard";

export class SubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionError";
  }
}

/** Seats in use — invited members hold a seat. */
export async function seatsUsed(companyId: string): Promise<number> {
  const members = await listMembershipsForCompany(companyId);
  return members.filter((m) => ["ACTIVE", "INVITED"].includes(m.status)).length;
}

/** Kept for the admin subscription page's Prisma select until 6g rewires it. */
export const SUBSCRIPTION_DETAIL_SELECT = {
  id: true, companyId: true, plan: true, planId: true, planVersionId: true,
  status: true, billingCycle: true, currency: true, priceCents: true,
  monthlyEquivalentCents: true, seats: true, seatsOverridden: true,
  seatOverrideReason: true, seatOverrideAt: true, trialStartsAt: true,
  trialEndsAt: true, startedAt: true, currentPeriodStart: true, currentPeriodEnd: true,
  pastDueSince: true, suspendedAt: true, suspendReason: true, cancelAt: true,
  cancelledAt: true, cancelReason: true, providerRef: true, createdAt: true, updatedAt: true,
} as const;

async function applyAccess(companyId: string, status: string, trialEndsAt: Date | null) {
  const access = accessFor({ status, trialEndsAt });
  await updateCompany(companyId, { isReadOnly: !access.writable });
  return access;
}

async function recordEvent(input: {
  subscriptionId: string;
  type: string;
  summary: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  actor: AdminActor;
}) {
  await addSubscriptionEvent({
    subscriptionId: input.subscriptionId,
    type: input.type,
    summary: input.summary,
    reason: input.reason ?? null,
    beforeJson: input.before === undefined ? null : JSON.stringify(input.before),
    afterJson: input.after === undefined ? null : JSON.stringify(input.after),
    actorUserId: input.actor.id,
    actorEmail: input.actor.email,
  });
}

// ── Creation and plan assignment ───────────────────────────────────────────

export interface AssignPlanInput {
  companyId: string;
  planCode: string;
  cycle: string;
  status?: string;
  trialStartsAt?: Date | null;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
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
  if (plan.contactOnly && plan.prices[cycle as BillingCycle]?.cycleAmountCents === 0) {
    throw new SubscriptionError(
      `${plan.name} is a contact-sales plan with no published ${cycle.toLowerCase()} price. Set one before assigning it.`,
    );
  }
  return assignmentFromPlan(plan, cycle);
}

export async function assignPlan(actor: AdminActor, input: AssignPlanInput): Promise<Subscription> {
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
  const existing = await getSubscriptionForCompany(input.companyId);

  const trialEndsAt =
    status === "TRIALING"
      ? (input.trialEndsAt ?? existing?.trialEndsAt ?? addDays(now, 30))
      : (input.trialEndsAt ?? null);
  const periodEnd =
    input.currentPeriodEnd ??
    (status === "ACTIVE" ? addMonths(now, CYCLE_MONTHS[assignment.billingCycle]) : null);

  const data: Partial<Subscription> = {
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
    trialStartsAt:
      status === "TRIALING" ? (input.trialStartsAt ?? existing?.trialStartsAt ?? now) : (input.trialStartsAt ?? null),
    trialEndsAt,
    startedAt: existing?.startedAt ?? (status === "ACTIVE" ? now : null),
    currentPeriodStart: existing?.currentPeriodStart ?? (status === "ACTIVE" ? now : null),
    currentPeriodEnd: periodEnd,
    suspendedAt: status === "SUSPENDED" ? (existing?.suspendedAt ?? now) : null,
    suspendReason: status === "SUSPENDED" ? (existing?.suspendReason ?? null) : null,
    pastDueSince: status === "PAST_DUE" ? (existing?.pastDueSince ?? now) : null,
    cancelledAt: status === "CANCELLED" ? (existing?.cancelledAt ?? now) : null,
    cancelAt: status === "CANCELLED" ? (existing?.cancelAt ?? null) : null,
    cancelReason: status === "CANCELLED" ? (existing?.cancelReason ?? null) : null,
  };

  let row: Subscription;
  if (existing) {
    await subsRepo.update(existing.id, data);
    row = { ...existing, ...data } as Subscription;
  } else {
    const id = newId();
    await subsRepo.set(id, { id, companyId: input.companyId, ...data } as Partial<Subscription>);
    row = { id, companyId: input.companyId, ...data } as Subscription;
  }

  await applyAccess(input.companyId, row.status, row.trialEndsAt);
  await recordEvent({
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

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: existing ? AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED : AUDIT_ACTIONS.SUBSCRIPTION_CREATED,
    entityType: "Subscription",
    entityId: row.id,
    summary: existing
      ? `${assignment.planCode} assigned (was ${existing.plan})`
      : `Subscription created on ${assignment.planCode}`,
    reason: input.reason ?? null,
    before: existing ?? undefined,
    after: row,
  });

  return row;
}

// ── Status transitions ─────────────────────────────────────────────────────

export interface StatusChangeInput {
  subscriptionId: string;
  to: string;
  reason?: string | null;
  atPeriodEnd?: boolean;
}

async function loadWithCompany(subscriptionId: string) {
  const existing = await subsRepo.get(subscriptionId);
  if (!existing) throw new SubscriptionError("That subscription no longer exists.");
  const company = await getCompany(existing.companyId);
  return { existing, companyName: company?.name ?? "—" };
}

export async function changeStatus(actor: AdminActor, input: StatusChangeInput): Promise<Subscription> {
  const { existing, companyName } = await loadWithCompany(input.subscriptionId);

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

  if (to === "CANCELLED" && input.atPeriodEnd) {
    const effective = existing.currentPeriodEnd ?? existing.trialEndsAt ?? addDays(now, 30);
    await subsRepo.update(existing.id, { cancelAt: effective, cancelReason: reason });
    const row = { ...existing, cancelAt: effective, cancelReason: reason };
    await recordEvent({
      subscriptionId: row.id,
      type: "CANCEL_SCHEDULED",
      summary: `Cancellation scheduled for ${effective.toISOString().slice(0, 10)}`,
      reason,
      before: { cancelAt: existing.cancelAt },
      after: { cancelAt: row.cancelAt },
      actor,
    });
    await recordPlatformAudit({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED,
      entityType: "Subscription",
      entityId: existing.id,
      summary: `${companyName}: cancellation scheduled for ${effective.toISOString().slice(0, 10)}`,
      reason,
      before: { cancelAt: existing.cancelAt, status: existing.status },
      after: { cancelAt: row.cancelAt, status: row.status },
    });
    return row;
  }

  const data: Partial<Subscription> = { status: to };
  switch (to) {
    case "ACTIVE":
      data.startedAt = existing.startedAt ?? now;
      data.currentPeriodStart = existing.currentPeriodStart ?? now;
      data.currentPeriodEnd =
        existing.currentPeriodEnd && existing.currentPeriodEnd > now
          ? existing.currentPeriodEnd
          : addMonths(now, CYCLE_MONTHS[(existing.billingCycle as BillingCycle) ?? "MONTHLY"] ?? 1);
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
    default:
      break;
  }

  await subsRepo.update(existing.id, data);
  const row = { ...existing, ...data } as Subscription;
  await applyAccess(row.companyId, row.status, row.trialEndsAt);
  await recordEvent({
    subscriptionId: row.id,
    type: "STATUS_CHANGED",
    summary: `Status ${existing.status} → ${row.status}`,
    reason,
    before: { status: existing.status },
    after: { status: row.status },
    actor,
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action:
      to === "CANCELLED" ? AUDIT_ACTIONS.SUBSCRIPTION_CANCELLED : AUDIT_ACTIONS.SUBSCRIPTION_STATUS_CHANGED,
    entityType: "Subscription",
    entityId: existing.id,
    summary: `${companyName}: ${existing.status} → ${to}`,
    reason,
    before: { status: existing.status },
    after: { status: to },
  });

  return row;
}

// ── Trials, seats, periods, notes ──────────────────────────────────────────

export async function extendTrial(
  actor: AdminActor,
  input: { subscriptionId: string; days?: number; until?: Date | null; reason?: string | null },
): Promise<Subscription> {
  const { existing, companyName } = await loadWithCompany(input.subscriptionId);

  const base = existing.trialEndsAt && existing.trialEndsAt > new Date() ? existing.trialEndsAt : new Date();
  const until = input.until ?? (input.days ? addDays(base, input.days) : null);
  if (!until) throw new SubscriptionError("Choose how long to extend the trial by.");
  if (Number.isNaN(until.getTime())) throw new SubscriptionError("That is not a valid date.");
  if (until <= new Date()) throw new SubscriptionError("A trial cannot be extended to a date in the past.");

  await subsRepo.update(existing.id, {
    trialEndsAt: until,
    trialStartsAt: existing.trialStartsAt ?? existing.createdAt,
  });
  const row = { ...existing, trialEndsAt: until };
  await applyAccess(row.companyId, row.status, row.trialEndsAt);
  await recordEvent({
    subscriptionId: row.id,
    type: "TRIAL_EXTENDED",
    summary: `Trial extended to ${until.toISOString().slice(0, 10)}`,
    reason: input.reason ?? null,
    before: { trialEndsAt: existing.trialEndsAt },
    after: { trialEndsAt: row.trialEndsAt },
    actor,
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_EXTENDED,
    entityType: "Subscription",
    entityId: existing.id,
    summary: `${companyName}: trial extended to ${until.toISOString().slice(0, 10)}`,
    reason: input.reason ?? null,
    before: { trialEndsAt: existing.trialEndsAt },
    after: { trialEndsAt: until },
  });

  return row;
}

export async function overrideSeats(
  actor: AdminActor,
  input: { subscriptionId: string; seats: number; reason: string },
): Promise<Subscription> {
  const { existing, companyName } = await loadWithCompany(input.subscriptionId);

  if (!Number.isInteger(input.seats) || input.seats < 1) {
    throw new SubscriptionError("Seat allowance must be a whole number of at least 1.");
  }
  const reason = input.reason?.trim();
  if (!reason) {
    throw new SubscriptionError("A seat override needs a reason. It is a commercial exception, and it is logged.");
  }

  const used = await seatsUsed(existing.companyId);
  if (input.seats < used) {
    throw new SubscriptionError(
      `${used} people currently have access. Reduce the team to ${input.seats} first — lowering the allowance never removes anyone automatically.`,
    );
  }

  const planSeats = existing.planId ? (await plansRepo.get(existing.planId))?.seats ?? null : null;
  const atPlanDefault = planSeats !== null && input.seats === planSeats;

  await subsRepo.update(existing.id, {
    seats: input.seats,
    seatsOverridden: planSeats === null ? true : input.seats !== planSeats,
    seatOverrideReason: atPlanDefault ? null : reason,
    seatOverrideAt: atPlanDefault ? null : new Date(),
    seatOverrideById: atPlanDefault ? null : actor.id,
  });
  const row = { ...existing, seats: input.seats, seatsOverridden: !atPlanDefault };
  await recordEvent({
    subscriptionId: row.id,
    type: "SEATS_OVERRIDDEN",
    summary: `Seat allowance ${existing.seats} → ${row.seats}`,
    reason,
    before: { seats: existing.seats, seatsOverridden: existing.seatsOverridden },
    after: { seats: row.seats, seatsOverridden: row.seatsOverridden },
    actor,
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_SEATS_OVERRIDDEN,
    entityType: "Subscription",
    entityId: existing.id,
    summary: `${companyName}: seats ${existing.seats} → ${input.seats}`,
    reason,
    before: { seats: existing.seats },
    after: { seats: input.seats },
  });

  return row;
}

export async function setPeriodEnd(
  actor: AdminActor,
  input: { subscriptionId: string; currentPeriodEnd: Date; reason?: string | null },
): Promise<Subscription> {
  const { existing, companyName } = await loadWithCompany(input.subscriptionId);
  if (Number.isNaN(input.currentPeriodEnd.getTime())) throw new SubscriptionError("That is not a valid date.");
  if (existing.currentPeriodStart && input.currentPeriodEnd <= existing.currentPeriodStart) {
    throw new SubscriptionError("The period end must fall after the period start.");
  }

  await subsRepo.update(existing.id, { currentPeriodEnd: input.currentPeriodEnd });
  const row = { ...existing, currentPeriodEnd: input.currentPeriodEnd };
  await recordEvent({
    subscriptionId: row.id,
    type: "PERIOD_CHANGED",
    summary: `Period end set to ${input.currentPeriodEnd.toISOString().slice(0, 10)}`,
    reason: input.reason ?? null,
    before: { currentPeriodEnd: existing.currentPeriodEnd },
    after: { currentPeriodEnd: row.currentPeriodEnd },
    actor,
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_PERIOD_CHANGED,
    entityType: "Subscription",
    entityId: existing.id,
    summary: `${companyName}: period end ${input.currentPeriodEnd.toISOString().slice(0, 10)}`,
    reason: input.reason ?? null,
    before: { currentPeriodEnd: existing.currentPeriodEnd },
    after: { currentPeriodEnd: input.currentPeriodEnd },
  });

  return row;
}

export async function addNote(actor: AdminActor, input: { subscriptionId: string; body: string }) {
  const body = input.body.trim();
  if (!body) throw new SubscriptionError("Write something first.");
  if (body.length > 4000) throw new SubscriptionError("That note is too long — keep it under 4000 characters.");

  const note = await addSubscriptionNote({
    subscriptionId: input.subscriptionId,
    body,
    authorUserId: actor.id,
    authorEmail: actor.email,
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_NOTE_ADDED,
    entityType: "Subscription",
    entityId: input.subscriptionId,
    summary: "Internal note added",
  });

  return note;
}

export async function setProviderRef(
  actor: AdminActor,
  input: { subscriptionId: string; providerRef: string | null },
): Promise<Subscription> {
  const ref = input.providerRef?.trim() || null;
  const existing = await subsRepo.get(input.subscriptionId);
  if (!existing) throw new SubscriptionError("That subscription no longer exists.");
  await subsRepo.update(input.subscriptionId, { providerRef: ref });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SUBSCRIPTION_STATUS_CHANGED,
    entityType: "Subscription",
    entityId: input.subscriptionId,
    summary: ref ? "Payment provider reference set" : "Payment provider reference cleared",
    after: { providerRef: ref },
  });
  return { ...existing, providerRef: ref };
}
