import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import { fromTimestamp, mapDocs, newId, toTimestamp, top } from "./firestore";
import type { CompanyUser } from "./types";

/**
 * `companyUsers/{id}` — membership + role of a user within one company (§3, §34).
 * Top-level (not under the company) so "every company for this user" is a single
 * query. `[companyId, userId]` uniqueness uses a deterministic id.
 *
 * Replaces `db.companyUser.*`.
 */

const DATE_FIELDS = ["invitedAt", "acceptedAt", "createdAt"] as const;

function decode(raw: DocumentData, id: string): CompanyUser {
  const out = { id, ...raw } as Record<string, unknown>;
  for (const f of DATE_FIELDS) out[f] = fromTimestamp(raw[f]);
  return out as unknown as CompanyUser;
}

function encode(data: Partial<CompanyUser>): DocumentData {
  const out: DocumentData = { ...data };
  delete out.id;
  for (const f of DATE_FIELDS) if (f in out) out[f] = toTimestamp(out[f] as Date | null);
  return out;
}

const col = () => top("companyUsers");
const membershipId = (companyId: string, userId: string) => `${companyId}__${userId}`;

export async function getMembership(
  companyId: string,
  userId: string,
): Promise<CompanyUser | null> {
  const snap = await col().doc(membershipId(companyId, userId)).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

/** Active memberships for a user, for the company switcher and tenant guard. */
export async function listMembershipsForUser(
  userId: string,
  opts: { status?: string } = {},
): Promise<CompanyUser[]> {
  let q = col().where("userId", "==", userId);
  if (opts.status) q = q.where("status", "==", opts.status);
  const snap = await q.get();
  return mapDocs(snap, decode);
}

export async function listMembershipsForCompany(
  companyId: string,
): Promise<CompanyUser[]> {
  const snap = await col().where("companyId", "==", companyId).get();
  return mapDocs(snap, decode);
}

export interface NewMembership {
  companyId: string;
  userId: string;
  role: string;
  status?: string;
  permissions?: string | null;
  invitedAt?: Date | null;
  acceptedAt?: Date | null;
}

export async function upsertMembership(input: NewMembership): Promise<CompanyUser> {
  const id = membershipId(input.companyId, input.userId);
  const now = new Date();
  const row: CompanyUser = {
    id,
    companyId: input.companyId,
    userId: input.userId,
    role: input.role,
    status: input.status ?? "ACTIVE",
    permissions: input.permissions ?? null,
    invitedAt: input.invitedAt ?? null,
    acceptedAt: input.acceptedAt ?? null,
    createdAt: now,
  };
  await col().doc(id).set(encode(row), { merge: true });
  return row;
}

export async function updateMembership(
  companyId: string,
  userId: string,
  data: Partial<CompanyUser>,
): Promise<void> {
  await col().doc(membershipId(companyId, userId)).update(encode(data));
}

export async function deleteMembership(
  companyId: string,
  userId: string,
): Promise<void> {
  await col().doc(membershipId(companyId, userId)).delete();
}

export { newId };
