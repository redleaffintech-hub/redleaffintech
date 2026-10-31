import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordPlatformAudit } from "@/server/admin/audit";
import type { AdminActor } from "@/server/admin/guard";
import { formatMoney } from "@/lib/money";
import { MAX_EXTRA_USERS_PER_REQUEST, extraChargeCents } from "@/lib/seats";

/** A refusal written for the person who hit it, safe to show as-is. */
export class SeatRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeatRequestError";
  }
}

const PRICE_NOTE = "per month";

// ─────────────────────────────────────────────────────────────────────────────
// Company side
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask for more users than the company's limit. This only RECORDS the ask — the
 * limit moves when (and only when) a platform administrator approves it.
 */
export async function requestExtraUsers(input: {
  companyId: string;
  userId: string;
  extraUsers: number;
  note?: string | null;
}) {
  const { companyId, userId } = input;
  if (!Number.isInteger(input.extraUsers) || input.extraUsers < 1) {
    throw new SeatRequestError("Enter how many additional users you need (at least 1).");
  }
  if (input.extraUsers > MAX_EXTRA_USERS_PER_REQUEST) {
    throw new SeatRequestError(`A request can cover at most ${MAX_EXTRA_USERS_PER_REQUEST} users. Contact support for larger teams.`);
  }
  const note = input.note?.trim().slice(0, 500) || null;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "companyId" = ${companyId} FOR UPDATE`;
    const subscription = await tx.subscription.findUnique({
      where: { companyId },
      select: { seats: true, extraSeatPriceCents: true },
    });
    if (!subscription) throw new SeatRequestError("This company has no subscription to add users to.");

    const pending = await tx.userSeatRequest.findFirst({ where: { companyId, status: "PENDING" }, select: { id: true } });
    if (pending) throw new SeatRequestError("You already have a request waiting for approval. Wait for it to be decided, or cancel it first.");

    const usersBefore = await tx.companyUser.count({ where: { companyId, status: { in: ["ACTIVE", "INVITED"] } } });
    const unit = subscription.extraSeatPriceCents;
    return tx.userSeatRequest.create({
      data: {
        companyId,
        requestedById: userId,
        extraUsers: input.extraUsers,
        unitPriceCents: unit,
        totalCents: extraChargeCents(input.extraUsers, unit),
        usersBefore,
        seatsBefore: subscription.seats,
        note,
      },
    });
  });
}

export async function cancelSeatRequest(companyId: string, requestId: string) {
  const result = await db.userSeatRequest.updateMany({
    where: { id: requestId, companyId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  if (result.count === 0) throw new SeatRequestError("That request is no longer pending.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin side
// ─────────────────────────────────────────────────────────────────────────────

export async function listSeatRequests(status?: string) {
  return db.userSeatRequest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { company: { select: { id: true, name: true } } },
  });
}

export async function pendingSeatRequestCount(): Promise<number> {
  return db.userSeatRequest.count({ where: { status: "PENDING" } });
}

/**
 * Approve: raise the company's limit by exactly the requested number and record
 * the paid extras so billing can show them. Runs under the subscription row lock
 * and re-reads the request, so a double click or two administrators acting at
 * once cannot grant the same request twice.
 */
export async function approveSeatRequest(actor: AdminActor, requestId: string) {
  const outcome = await db.$transaction(async (tx) => {
    const request = await tx.userSeatRequest.findUnique({
      where: { id: requestId },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!request) throw new SeatRequestError("That request no longer exists.");

    await tx.$queryRaw`SELECT id FROM "Subscription" WHERE "companyId" = ${request.companyId} FOR UPDATE`;
    const fresh = await tx.userSeatRequest.findUnique({ where: { id: requestId }, select: { status: true } });
    if (fresh?.status !== "PENDING") throw new SeatRequestError(`That request was already ${fresh?.status.toLowerCase()}.`);

    const subscription = await tx.subscription.findUnique({ where: { companyId: request.companyId } });
    if (!subscription) throw new SeatRequestError("The company has no subscription to add users to.");

    const updated = await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        seats: { increment: request.extraUsers },
        extraSeats: { increment: request.extraUsers },
        extraSeatPriceCents: request.unitPriceCents,
      },
    });
    await tx.userSeatRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", decidedById: actor.id, decidedByEmail: actor.email, decidedAt: new Date() },
    });
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: subscription.id,
        type: "EXTRA_SEATS_APPROVED",
        summary: `${request.extraUsers} additional user${request.extraUsers === 1 ? "" : "s"} approved — seats ${subscription.seats} → ${updated.seats}`,
        beforeJson: JSON.stringify({ seats: subscription.seats, extraSeats: subscription.extraSeats }),
        afterJson: JSON.stringify({ seats: updated.seats, extraSeats: updated.extraSeats }),
        actorUserId: actor.id,
        actorEmail: actor.email,
      },
    });
    await tx.notification.create({
      data: {
        companyId: request.companyId,
        type: "SEAT_REQUEST",
        title: "Additional users approved",
        body: `You can now add ${request.extraUsers} more user${request.extraUsers === 1 ? "" : "s"} (${formatMoney(request.totalCents)} ${PRICE_NOTE}). Your limit is ${updated.seats} users.`,
        severity: "INFO",
        link: "/company/users",
      },
    });
    return { request, before: subscription.seats, after: updated.seats };
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SEAT_REQUEST_APPROVED,
    entityType: "UserSeatRequest",
    entityId: requestId,
    summary: `${outcome.request.company.name}: +${outcome.request.extraUsers} users approved (${formatMoney(outcome.request.totalCents)} ${PRICE_NOTE}), seats ${outcome.before} → ${outcome.after}`,
    before: { seats: outcome.before },
    after: { seats: outcome.after },
  });
  return outcome;
}

export async function rejectSeatRequest(actor: AdminActor, requestId: string, reason: string) {
  const why = reason.trim();
  if (!why) throw new SeatRequestError("Give a reason — the company is shown it.");

  const request = await db.$transaction(async (tx) => {
    const found = await tx.userSeatRequest.findUnique({
      where: { id: requestId },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!found) throw new SeatRequestError("That request no longer exists.");
    const result = await tx.userSeatRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "REJECTED", decidedById: actor.id, decidedByEmail: actor.email, decidedAt: new Date(), decisionNote: why },
    });
    if (result.count === 0) throw new SeatRequestError("That request was already decided.");
    await tx.notification.create({
      data: {
        companyId: found.companyId,
        type: "SEAT_REQUEST",
        title: "Additional users request declined",
        body: `Your request for ${found.extraUsers} more user${found.extraUsers === 1 ? "" : "s"} was declined: ${why}`,
        severity: "WARNING",
        link: "/company/users",
      },
    });
    return found;
  });

  await recordPlatformAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AUDIT_ACTIONS.SEAT_REQUEST_REJECTED,
    entityType: "UserSeatRequest",
    entityId: requestId,
    summary: `${request.company.name}: +${request.extraUsers} users rejected`,
    reason: why,
  });
  return request;
}
