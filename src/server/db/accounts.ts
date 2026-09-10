import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import {
  companyRef,
  fromTimestamp,
  mapDocs,
  newId,
  sub,
  toTimestamp,
  type Tx,
} from "./firestore";
import type { Account } from "./types";

/**
 * `companies/{companyId}/accounts/{accountId}` — the chart of accounts.
 *
 * Replaces `db.account.*`. Uniqueness of `[companyId, code]` is held by a guard
 * doc `companies/{companyId}/accountCodes/{code}` written in the same
 * transaction as the account.
 */

const DATE_FIELDS = ["createdAt", "updatedAt"] as const;

function decode(raw: DocumentData, id: string): Account {
  const out = { id, ...raw } as Record<string, unknown>;
  for (const f of DATE_FIELDS) out[f] = fromTimestamp(raw[f]);
  return out as unknown as Account;
}

function encode(data: Partial<Account>): DocumentData {
  const out: DocumentData = { ...data };
  delete out.id;
  for (const f of DATE_FIELDS) if (f in out) out[f] = toTimestamp(out[f] as Date);
  return out;
}

const col = (companyId: string) => sub(companyId, "accounts");
const codeGuard = (companyId: string, code: string) =>
  companyRef(companyId).collection("accountCodes").doc(code);

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getAccount(
  companyId: string,
  id: string,
): Promise<Account | null> {
  const snap = await col(companyId).doc(id).get();
  return snap.exists ? decode(snap.data()!, snap.id) : null;
}

export async function listAccounts(companyId: string): Promise<Account[]> {
  const snap = await col(companyId).orderBy("code").get();
  return mapDocs(snap, decode);
}

export async function listAccountsByType(
  companyId: string,
  types: string[],
): Promise<Account[]> {
  if (types.length === 0) return [];
  const snap = await col(companyId)
    .where("type", "in", types.slice(0, 10))
    .orderBy("code")
    .get();
  return mapDocs(snap, decode);
}

export async function listAccountsByIds(
  companyId: string,
  ids: string[],
): Promise<Account[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const out: Account[] = [];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await col(companyId)
      .where("__name__", "in", chunk.map((id) => col(companyId).doc(id)))
      .get();
    out.push(...mapDocs(snap, decode));
  }
  return out;
}

/** Read accounts by id inside a transaction (used by the posting engine). */
export async function getAccountsTx(
  tx: Tx,
  companyId: string,
  ids: string[],
): Promise<Map<string, Account>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, Account>();
  if (unique.length === 0) return map;
  const refs = unique.map((id) => col(companyId).doc(id));
  const snaps = await tx.getAll(...refs);
  for (const snap of snaps) {
    if (snap.exists) map.set(snap.id, decode(snap.data()!, snap.id));
  }
  return map;
}

/** Resolve a control account by its stable handle (AR, AP, GST payable…). */
export async function getSystemAccount(
  companyId: string,
  systemKey: string,
): Promise<Account | null> {
  const snap = await col(companyId).where("systemKey", "==", systemKey).limit(1).get();
  return snap.empty ? null : decode(snap.docs[0].data(), snap.docs[0].id);
}

export async function getSystemAccountTx(
  tx: Tx,
  companyId: string,
  systemKey: string,
): Promise<Account | null> {
  const snap = await tx.get(
    col(companyId).where("systemKey", "==", systemKey).limit(1),
  );
  return snap.empty ? null : decode(snap.docs[0].data(), snap.docs[0].id);
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface NewAccount {
  companyId: string;
  code: string;
  name: string;
  type: string;
  subtype: string;
  parentId?: string | null;
  description?: string | null;
  isActive?: boolean;
  isSystem?: boolean;
  systemKey?: string | null;
  currency?: string;
}

export async function createAccount(input: NewAccount): Promise<Account> {
  const id = newId();
  const now = new Date();
  const account: Account = {
    id,
    companyId: input.companyId,
    code: input.code,
    name: input.name,
    type: input.type,
    subtype: input.subtype,
    parentId: input.parentId ?? null,
    description: input.description ?? null,
    isActive: input.isActive ?? true,
    isSystem: input.isSystem ?? false,
    systemKey: input.systemKey ?? null,
    currency: input.currency ?? "CAD",
    createdAt: now,
    updatedAt: now,
  };
  await companyRef(input.companyId).firestore.runTransaction(async (tx) => {
    const guardRef = codeGuard(input.companyId, input.code);
    const guard = await tx.get(guardRef);
    if (guard.exists) {
      throw new Error(`Account code ${input.code} already exists in this company.`);
    }
    tx.set(col(input.companyId).doc(id), encode(account));
    tx.set(guardRef, { accountId: id });
  });
  return account;
}

export async function updateAccount(
  companyId: string,
  id: string,
  data: Partial<Account>,
): Promise<void> {
  await col(companyId)
    .doc(id)
    .update({ ...encode(data), updatedAt: toTimestamp(new Date()) });
}
