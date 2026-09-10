import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import { fromTimestamp, mapDocs, newId, serverNow, sub, type Tx } from "./firestore";
import type { AuditLog } from "./types";

/**
 * `companies/{companyId}/auditLogs/{id}` — the tenant-scoped audit trail (§27).
 * Entries with no company (platform-level login/export) are not written here;
 * those belong to `platformAuditLogs` (Phase 7).
 *
 * Replaces `db.auditLog.*` for the tenant path.
 */

function decode(raw: DocumentData, id: string): AuditLog {
  return {
    id,
    companyId: raw.companyId ?? null,
    userId: raw.userId ?? null,
    action: raw.action,
    entityType: raw.entityType,
    entityId: raw.entityId ?? null,
    summary: raw.summary,
    metadata: raw.metadata ?? null,
    ipAddress: raw.ipAddress ?? null,
    createdAt: fromTimestamp(raw.createdAt) ?? new Date(0),
  };
}

const col = (companyId: string) => sub(companyId, "auditLogs");

export interface NewAuditLog {
  companyId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: unknown;
  ipAddress?: string | null;
}

function build(input: NewAuditLog): { id: string; data: DocumentData } {
  return {
    id: newId(),
    data: {
      companyId: input.companyId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata:
        input.metadata === undefined
          ? null
          : typeof input.metadata === "string"
            ? input.metadata
            : JSON.stringify(input.metadata),
      ipAddress: input.ipAddress ?? null,
      createdAt: serverNow(),
    },
  };
}

export async function recordAudit(input: NewAuditLog): Promise<void> {
  const { id, data } = build(input);
  await col(input.companyId).doc(id).set(data);
}

/** Write an audit entry as part of a larger transaction. */
export function recordAuditTx(tx: Tx, input: NewAuditLog): void {
  const { id, data } = build(input);
  tx.set(col(input.companyId).doc(id), data);
}

export async function listAuditLogs(
  companyId: string,
  opts: { limit?: number; entityType?: string; entityId?: string } = {},
): Promise<AuditLog[]> {
  let q = col(companyId).orderBy("createdAt", "desc");
  if (opts.entityType && opts.entityId) {
    q = col(companyId)
      .where("entityType", "==", opts.entityType)
      .where("entityId", "==", opts.entityId)
      .orderBy("createdAt", "desc");
  }
  if (opts.limit) q = q.limit(opts.limit);
  const snap = await q.get();
  return mapDocs(snap, decode);
}
