import "server-only";

import { makeTopRepo } from "./_doc-repo";
import { converter, mapDocs, newId, top, type Tx } from "./firestore";
import type {
  AuthAttempt,
  Firm,
  FirmUser,
  Plan,
  PlanVersion,
  PlatformAuditLog,
  RegionalTaxRate,
  Session,
  Subscription,
  SubscriptionCompany,
  SubscriptionEvent,
  SubscriptionNote,
  UserToken,
} from "./types";

/**
 * Platform (cross-tenant) collections — firms, the sellable plan catalogue,
 * subscriptions, reference tax rates, and auth substrate. The boundary is
 * `isPlatformAdmin`, not a companyId (§ schema notes).
 */

// ── Firms ──────────────────────────────────────────────────────────────────
export const firms = makeTopRepo<Firm>("firms", ["createdAt"]);

const firmUserId = (firmId: string, userId: string) => `${firmId}__${userId}`;
const { decode: decFU, encode: encFU } = converter<FirmUser>(["createdAt"]);
export async function listFirmUsers(firmId: string): Promise<FirmUser[]> {
  return mapDocs(await top("firmUsers").where("firmId", "==", firmId).get(), decFU);
}
export async function listFirmsForUser(userId: string): Promise<FirmUser[]> {
  return mapDocs(await top("firmUsers").where("userId", "==", userId).get(), decFU);
}
export async function upsertFirmUser(
  input: Omit<FirmUser, "id" | "createdAt"> & { createdAt?: Date },
): Promise<FirmUser> {
  const id = firmUserId(input.firmId, input.userId);
  const row = { ...input, id, createdAt: input.createdAt ?? new Date() } as FirmUser;
  await top("firmUsers").doc(id).set(encFU(row), { merge: true });
  return row;
}

// ── Plans ──────────────────────────────────────────────────────────────────
export const plans = makeTopRepo<Plan>(
  "plans",
  ["publishedAt", "archivedAt", "createdAt", "updatedAt"],
  { touchUpdatedAt: true },
);
export const planVersions = makeTopRepo<PlanVersion>("planVersions", ["publishedAt"]);

export async function listPlanVersions(planId: string): Promise<PlanVersion[]> {
  return planVersions.list({ where: [["planId", "==", planId]], orderBy: "version", direction: "desc" });
}
export async function getPublishedPlans(): Promise<Plan[]> {
  return plans.list({
    where: [
      ["status", "==", "PUBLISHED"],
      ["isPublic", "==", true],
    ],
    orderBy: "sortOrder",
  });
}
export async function getPlanByCode(code: string): Promise<Plan | null> {
  const rows = await plans.list({ where: [["code", "==", code]], limit: 1 });
  return rows[0] ?? null;
}

// ── Subscriptions ──────────────────────────────────────────────────────────
export const subscriptions = makeTopRepo<Subscription>(
  "subscriptions",
  [
    "seatOverrideAt",
    "trialStartsAt",
    "trialEndsAt",
    "startedAt",
    "currentPeriodStart",
    "currentPeriodEnd",
    "pastDueSince",
    "suspendedAt",
    "cancelAt",
    "cancelledAt",
    "createdAt",
    "updatedAt",
  ],
  { touchUpdatedAt: true },
);

/** One company has one subscription; keyed by companyId is easiest for the app. */
export async function getSubscriptionForCompany(companyId: string): Promise<Subscription | null> {
  const rows = await subscriptions.list({ where: [["companyId", "==", companyId]], limit: 1 });
  return rows[0] ?? null;
}

const { decode: decEvt, encode: encEvt } = converter<SubscriptionEvent>(["createdAt"]);
const { decode: decNote, encode: encNote } = converter<SubscriptionNote>(["createdAt"]);
const { decode: decSC, encode: encSC } = converter<SubscriptionCompany>(["createdAt"]);

export async function listSubscriptionEvents(subscriptionId: string): Promise<SubscriptionEvent[]> {
  return mapDocs(
    await top("subscriptionEvents")
      .where("subscriptionId", "==", subscriptionId)
      .orderBy("createdAt", "desc")
      .get(),
    decEvt,
  );
}
export function createSubscriptionEventTx(tx: Tx, input: Omit<SubscriptionEvent, "id" | "createdAt">): void {
  const row = { ...input, id: newId(), createdAt: new Date() } as SubscriptionEvent;
  tx.set(top("subscriptionEvents").doc(row.id), encEvt(row));
}
export async function addSubscriptionNote(
  input: Omit<SubscriptionNote, "id" | "createdAt">,
): Promise<SubscriptionNote> {
  const row = { ...input, id: newId(), createdAt: new Date() } as SubscriptionNote;
  await top("subscriptionNotes").doc(row.id).set(encNote(row));
  return row;
}
export async function listSubscriptionNotes(subscriptionId: string): Promise<SubscriptionNote[]> {
  return mapDocs(
    await top("subscriptionNotes")
      .where("subscriptionId", "==", subscriptionId)
      .orderBy("createdAt", "desc")
      .get(),
    decNote,
  );
}
export async function listSubscriptionCompanies(subscriptionId: string): Promise<SubscriptionCompany[]> {
  return mapDocs(
    await top("subscriptionCompanies").where("subscriptionId", "==", subscriptionId).get(),
    decSC,
  );
}
export async function setSubscriptionCompany(
  input: Omit<SubscriptionCompany, "id" | "createdAt"> & { createdAt?: Date },
): Promise<void> {
  await top("subscriptionCompanies")
    .doc(input.companyId)
    .set(encSC({ ...input, id: input.companyId, createdAt: input.createdAt ?? new Date() }), {
      merge: true,
    });
}

// ── Regional tax rates (reference) ─────────────────────────────────────────
export const regionalTaxRates = makeTopRepo<RegionalTaxRate>(
  "regionalTaxRates",
  ["effectiveFrom", "effectiveTo", "createdAt", "updatedAt"],
  { touchUpdatedAt: true },
);

/** The rate in force for a province on a date (latest effective on or before). */
export async function currentRegionalRate(
  province: string,
  onDate: Date,
): Promise<RegionalTaxRate | null> {
  const rows = await regionalTaxRates.list({
    where: [["province", "==", province]],
    orderBy: "effectiveFrom",
    direction: "desc",
  });
  return (
    rows.find((r) => r.effectiveFrom <= onDate && (!r.effectiveTo || r.effectiveTo >= onDate)) ?? null
  );
}

// ── Auth substrate ─────────────────────────────────────────────────────────
//
// `sessions/{token}` — the opaque session token IS the doc id (a uuid, unique).
const { decode: decSess, encode: encSess } = converter<Session>([
  "mfaVerifiedAt",
  "lastSeenAt",
  "expiresAt",
  "revokedAt",
  "createdAt",
]);
export async function getSessionByToken(token: string): Promise<Session | null> {
  const snap = await top("sessions").doc(token).get();
  return snap.exists ? decSess(snap.data()!, snap.id) : null;
}
export async function createSession(
  input: Omit<Session, "id" | "createdAt"> & { token: string },
): Promise<Session> {
  const row = { ...input, id: input.token, createdAt: new Date() } as Session;
  await top("sessions").doc(input.token).set(encSess(row));
  return row;
}
export async function updateSession(token: string, data: Partial<Session>): Promise<void> {
  await top("sessions").doc(token).update(encSess(data));
}
export async function revokeSessionByToken(token: string): Promise<void> {
  await top("sessions").doc(token).set({ revokedAt: encSess({ revokedAt: new Date() }).revokedAt }, { merge: true });
}
export async function revokeSessionsForUser(userId: string, scope?: string): Promise<number> {
  let q: FirebaseFirestore.Query = top("sessions").where("userId", "==", userId);
  if (scope) q = q.where("scope", "==", scope);
  const snap = await q.get();
  const live = snap.docs.filter((d) => !d.data().revokedAt);
  const now = encSess({ revokedAt: new Date() }).revokedAt;
  const batch = top("sessions").firestore.batch();
  for (const d of live) batch.update(d.ref, { revokedAt: now });
  if (live.length) await batch.commit();
  return live.length;
}

const { decode: decTok, encode: encTok } = converter<UserToken>(["expiresAt", "usedAt", "createdAt"]);
export async function getUserTokenByHash(tokenHash: string): Promise<UserToken | null> {
  const snap = await top("userTokens").where("tokenHash", "==", tokenHash).limit(1).get();
  return snap.empty ? null : decTok(snap.docs[0].data(), snap.docs[0].id);
}
export async function createUserToken(input: Omit<UserToken, "id" | "createdAt">): Promise<UserToken> {
  const row = { ...input, id: newId(), createdAt: new Date() } as UserToken;
  await top("userTokens").doc(row.id).set(encTok(row));
  return row;
}
export async function markUserTokenUsed(id: string): Promise<void> {
  await top("userTokens").doc(id).update({ usedAt: encTok({ usedAt: new Date() }).usedAt });
}

/** Spend (mark used) every unused token a user holds for the given purposes. */
export async function spendUserTokens(userId: string, purposes: string[]): Promise<void> {
  const snap = await top("userTokens").where("userId", "==", userId).get();
  const now = encTok({ usedAt: new Date() }).usedAt;
  const batch = top("userTokens").firestore.batch();
  let n = 0;
  for (const d of snap.docs) {
    const t = d.data();
    if (!t.usedAt && purposes.includes(t.purpose)) {
      batch.update(d.ref, { usedAt: now });
      n++;
    }
  }
  if (n) await batch.commit();
}

const { encode: encAttempt, decode: decAttempt } = converter<AuthAttempt>(["createdAt"]);
export async function recordAuthAttempt(
  input: Omit<AuthAttempt, "id" | "createdAt">,
): Promise<void> {
  const row = { ...input, id: newId(), createdAt: new Date() } as AuthAttempt;
  await top("authAttempts").doc(row.id).set(encAttempt(row));
}

/** Failed attempts matching the filter since `since`, newest first. */
export async function failedAuthAttemptsSince(filter: {
  email?: string;
  ipAddress?: string;
  scope?: string;
  since: Date;
}): Promise<AuthAttempt[]> {
  let q: FirebaseFirestore.Query = top("authAttempts").where("success", "==", false);
  if (filter.email) q = q.where("email", "==", filter.email);
  if (filter.ipAddress) q = q.where("ipAddress", "==", filter.ipAddress);
  if (filter.scope) q = q.where("scope", "==", filter.scope);
  const rows = mapDocs(await q.get(), decAttempt).filter((r) => r.createdAt >= filter.since);
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function clearFailedAuthAttempts(
  email: string,
  scope: string,
  since: Date,
): Promise<void> {
  const snap = await top("authAttempts")
    .where("success", "==", false)
    .where("email", "==", email)
    .where("scope", "==", scope)
    .get();
  const batch = top("authAttempts").firestore.batch();
  let n = 0;
  for (const d of snap.docs) {
    if ((d.data().createdAt?.toDate?.() ?? new Date(0)) >= since) {
      batch.delete(d.ref);
      n++;
    }
  }
  if (n) await batch.commit();
}

export async function recentFailedAuthAttempts(scope: string, limit = 20): Promise<AuthAttempt[]> {
  const snap = await top("authAttempts")
    .where("success", "==", false)
    .where("scope", "==", scope)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return mapDocs(snap, decAttempt);
}

// ── Platform audit log ─────────────────────────────────────────────────────
const { encode: encPAL, decode: decPAL } = converter<PlatformAuditLog>(["createdAt"]);
export async function recordPlatformAudit(
  input: Omit<PlatformAuditLog, "id" | "createdAt">,
): Promise<void> {
  const row = { ...input, id: newId(), createdAt: new Date() } as PlatformAuditLog;
  await top("platformAuditLogs").doc(row.id).set(encPAL(row));
}
export async function listPlatformAudit(opts: { limit?: number } = {}): Promise<PlatformAuditLog[]> {
  let q: FirebaseFirestore.Query = top("platformAuditLogs").orderBy("createdAt", "desc");
  if (opts.limit) q = q.limit(opts.limit);
  return mapDocs(await q.get(), decPAL);
}
