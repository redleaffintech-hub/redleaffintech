import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import { fromTimestamp, mapDocs, newId, toTimestamp, top, type Tx } from "./firestore";
import type { User } from "./types";

/**
 * `users/{userId}` — platform identity.
 *
 * Replaces `db.user.*`. Phase 6 moves password/MFA ownership to Firebase Auth;
 * until then the fields stay here. Email uniqueness is held by a guard doc
 * `userEmails/{lowercasedEmail}` → `{ userId }`.
 */

const DATE_FIELDS = [
  "lastLoginAt",
  "createdAt",
  "updatedAt",
  "platformAdminSince",
  "platformAdminSuspendedAt",
  "passwordChangedAt",
  "mfaEnrolledAt",
] as const;

function decode(raw: DocumentData, id: string): User {
  const out = { id, ...raw } as Record<string, unknown>;
  for (const f of DATE_FIELDS) out[f] = fromTimestamp(raw[f]);
  return out as unknown as User;
}

function encode(data: Partial<User>): DocumentData {
  const out: DocumentData = { ...data };
  delete out.id;
  for (const f of DATE_FIELDS) if (f in out) out[f] = toTimestamp(out[f] as Date | null);
  return out;
}

const col = () => top("users");
const emailGuard = (email: string) => top("userEmails").doc(email.toLowerCase());

export async function getUser(id: string): Promise<User | null> {
  const snap = await col().doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function getUserTx(tx: Tx, id: string): Promise<User | null> {
  const snap = await tx.get(col().doc(id));
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const snap = await col().where("email", "==", email.toLowerCase()).limit(1).get();
  return snap.empty ? null : decode(snap.docs[0].data(), snap.docs[0].id);
}

export async function listUsersByIds(ids: string[]): Promise<User[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const out: User[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await col()
      .where("__name__", "in", chunk.map((id) => col().doc(id)))
      .get();
    out.push(...mapDocs(snap, decode));
  }
  return out;
}

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
  isPlatformAdmin?: boolean;
  mustChangePassword?: boolean;
}

export async function createUser(input: NewUser): Promise<User> {
  const id = newId();
  const now = new Date();
  const user: User = {
    id,
    email: input.email.toLowerCase(),
    name: input.name,
    passwordHash: input.passwordHash,
    isPlatformAdmin: input.isPlatformAdmin ?? false,
    mfaEnabled: false,
    lastLoginAt: null,
    activeCompanyId: null,
    createdAt: now,
    updatedAt: now,
    platformAdminSince: null,
    platformAdminSuspendedAt: null,
    mustChangePassword: input.mustChangePassword ?? false,
    passwordChangedAt: null,
    mfaSecret: null,
    mfaEnrolledAt: null,
  };
  await col().firestore.runTransaction(async (tx) => {
    const guardRef = emailGuard(user.email);
    const guard = await tx.get(guardRef);
    if (guard.exists) throw new Error(`A user with email ${user.email} already exists.`);
    tx.set(col().doc(id), encode(user));
    tx.set(guardRef, { userId: id });
  });
  return user;
}

export async function updateUser(id: string, data: Partial<User>): Promise<void> {
  await col().doc(id).update({ ...encode(data), updatedAt: toTimestamp(new Date()) });
}

export function updateUserTx(tx: Tx, id: string, data: Partial<User>): void {
  tx.update(col().doc(id), { ...encode(data), updatedAt: toTimestamp(new Date()) });
}
