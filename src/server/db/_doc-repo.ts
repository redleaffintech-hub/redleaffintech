import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import {
  converter,
  mapDocs,
  newId,
  sub,
  toTimestamp,
  top,
  type Tx,
} from "./firestore";

/**
 * Shared repository shape for the five line-item documents that share a
 * structure — Invoice, Estimate, Bill, Expense, CreditNote. Each stores its
 * `lines` as an embedded array (always read with the parent, never queried
 * across parents) and links to a posted `journalEntryId`.
 *
 * A per-type module calls `makeDocRepo` with its collection name and `Date`
 * fields and re-exports the typed result.
 */
export interface DocRepo<T extends { id: string; companyId: string }> {
  get(companyId: string, id: string): Promise<T | null>;
  getTx(tx: Tx, companyId: string, id: string): Promise<T | null>;
  list(
    companyId: string,
    opts?: { where?: [string, FirebaseFirestore.WhereFilterOp, unknown][]; orderBy?: string; direction?: "asc" | "desc"; limit?: number },
  ): Promise<T[]>;
  findBySource(companyId: string, sourceId: string, field?: string): Promise<T | null>;
  create(input: Partial<T> & { companyId: string }): Promise<T>;
  update(companyId: string, id: string, data: Partial<T>): Promise<T>;
  updateTx(tx: Tx, companyId: string, id: string, data: Partial<T>): void;
  createTx(tx: Tx, input: Partial<T> & { companyId: string }): T;
  remove(companyId: string, id: string): Promise<void>;
}

export function makeDocRepo<T extends { id: string; companyId: string }>(
  collectionName: string,
  dateFields: readonly string[],
  opts: { embedLines?: boolean; touchUpdatedAt?: boolean } = { embedLines: true, touchUpdatedAt: true },
): DocRepo<T> {
  const { decode, encode } = converter<T>(dateFields);
  const col = (companyId: string) => sub(companyId, collectionName);
  const embedLines = opts.embedLines ?? true;
  const touchUpdatedAt = opts.touchUpdatedAt ?? true;

  function build(input: Partial<T> & { companyId: string }): T {
    const id = (input.id as string) ?? newId();
    const now = new Date();
    const base: Record<string, unknown> = { ...input, id };
    if (embedLines && base.lines === undefined) base.lines = [];
    base.createdAt = (input as Record<string, unknown>).createdAt ?? now;
    if (touchUpdatedAt) base.updatedAt = now;
    return base as unknown as T;
  }

  return {
    async get(companyId, id) {
      const snap = await col(companyId).doc(id).get();
      return snap.exists ? decode(snap.data()!, snap.id) : null;
    },
    async getTx(tx, companyId, id) {
      const snap = await tx.get(col(companyId).doc(id));
      return snap.exists ? decode(snap.data()!, snap.id) : null;
    },
    async list(companyId, opts = {}) {
      let q: FirebaseFirestore.Query = col(companyId);
      for (const [f, op, v] of opts.where ?? []) q = q.where(f, op, v);
      if (opts.orderBy) q = q.orderBy(opts.orderBy, opts.direction ?? "asc");
      if (opts.limit) q = q.limit(opts.limit);
      return mapDocs(await q.get(), decode);
    },
    async findBySource(companyId, sourceId, field = "estimateId") {
      const snap = await col(companyId).where(field, "==", sourceId).limit(1).get();
      return snap.empty ? null : decode(snap.docs[0].data(), snap.docs[0].id);
    },
    async create(input) {
      const row = build(input);
      await col(input.companyId).doc(row.id).set(encode(row) as DocumentData);
      return row;
    },
    createTx(tx, input) {
      const row = build(input);
      tx.set(col(input.companyId).doc(row.id), encode(row) as DocumentData);
      return row;
    },
    async update(companyId, id, data) {
      const patch = { ...encode(data) };
      if (touchUpdatedAt) patch.updatedAt = toTimestamp(new Date());
      await col(companyId).doc(id).update(patch);
      const snap = await col(companyId).doc(id).get();
      return decode(snap.data()!, snap.id);
    },
    updateTx(tx, companyId, id, data) {
      const patch = { ...encode(data) };
      if (touchUpdatedAt) patch.updatedAt = toTimestamp(new Date());
      tx.update(col(companyId).doc(id), patch);
    },
    async remove(companyId, id) {
      await col(companyId).doc(id).delete();
    },
  };
}

/**
 * A repository over a TOP-LEVEL collection (platform data — no company scope):
 * `users`, `firms`, `plans`, `subscriptions`, `regionalTaxRates`, …
 */
export interface TopRepo<T extends { id: string }> {
  get(id: string): Promise<T | null>;
  getTx(tx: Tx, id: string): Promise<T | null>;
  list(opts?: {
    where?: [string, FirebaseFirestore.WhereFilterOp, unknown][];
    orderBy?: string;
    direction?: "asc" | "desc";
    limit?: number;
  }): Promise<T[]>;
  set(id: string, data: Partial<T>): Promise<void>;
  create(input: Partial<T> & Record<string, unknown>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<void>;
  remove(id: string): Promise<void>;
}

export function makeTopRepo<T extends { id: string }>(
  collectionName: string,
  dateFields: readonly string[],
  opts: { touchUpdatedAt?: boolean } = {},
): TopRepo<T> {
  const { decode, encode } = converter<T>(dateFields);
  const col = () => top(collectionName);
  const touch = opts.touchUpdatedAt ?? false;

  return {
    async get(id) {
      const snap = await col().doc(id).get();
      return snap.exists ? decode(snap.data()!, snap.id) : null;
    },
    async getTx(tx, id) {
      const snap = await tx.get(col().doc(id));
      return snap.exists ? decode(snap.data()!, snap.id) : null;
    },
    async list(o = {}) {
      let q: FirebaseFirestore.Query = col();
      for (const [f, op, v] of o.where ?? []) q = q.where(f, op, v);
      if (o.orderBy) q = q.orderBy(o.orderBy, o.direction ?? "asc");
      if (o.limit) q = q.limit(o.limit);
      return mapDocs(await q.get(), decode);
    },
    async set(id, data) {
      await col().doc(id).set(encode(data) as DocumentData, { merge: true });
    },
    async create(input) {
      const id = (input.id as string) ?? newId();
      const now = new Date();
      const row: Record<string, unknown> = { ...input, id, createdAt: input.createdAt ?? now };
      if (touch) row.updatedAt = now;
      await col().doc(id).set(encode(row as Partial<T>) as DocumentData);
      return row as unknown as T;
    },
    async update(id, data) {
      const patch = { ...encode(data) };
      if (touch) patch.updatedAt = toTimestamp(new Date());
      await col().doc(id).update(patch);
    },
    async remove(id) {
      await col().doc(id).delete();
    },
  };
}
