import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import {
  converter,
  mapDocs,
  newId,
  sub,
  toTimestamp,
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
): DocRepo<T> {
  const { decode, encode } = converter<T>(dateFields);
  const col = (companyId: string) => sub(companyId, collectionName);

  function build(input: Partial<T> & { companyId: string }): T {
    const id = (input.id as string) ?? newId();
    const now = new Date();
    return {
      lines: [],
      ...input,
      id,
      createdAt: (input as Record<string, unknown>).createdAt ?? now,
      updatedAt: now,
    } as unknown as T;
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
      await col(companyId)
        .doc(id)
        .update({ ...encode(data), updatedAt: toTimestamp(new Date()) });
      const snap = await col(companyId).doc(id).get();
      return decode(snap.data()!, snap.id);
    },
    updateTx(tx, companyId, id, data) {
      tx.update(col(companyId).doc(id), {
        ...encode(data),
        updatedAt: toTimestamp(new Date()),
      });
    },
    async remove(companyId, id) {
      await col(companyId).doc(id).delete();
    },
  };
}
