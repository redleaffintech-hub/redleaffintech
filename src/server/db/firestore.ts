import "server-only";

import { randomUUID } from "node:crypto";
import {
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

import { firestore } from "@/lib/firebase-admin";

/**
 * Shared Firestore plumbing for the data-access layer that replaces Prisma
 * (§31). Every repository under src/server/db builds on this.
 *
 * COLLECTION LAYOUT (see FIREBASE-MIGRATION.md for the full map)
 *   Platform / cross-tenant, top-level:
 *     users, sessions, companyUsers, firms, firmUsers, plans, planVersions,
 *     subscriptions, subscriptionEvents, subscriptionNotes, subscriptionCompanies,
 *     regionalTaxRates, platformAuditLogs, authAttempts, userTokens
 *   Tenant-owned, under companies/{companyId}/<name>:
 *     accounts, taxCodes, taxPeriods, taxEntries, fiscalPeriods,
 *     fiscalCalendarChanges, customers, vendors, items, inventoryMovements,
 *     estimates, invoices, creditNotes, bills, expenses, payments,
 *     paymentAllocations, journalEntries, journalLines, accountPeriodBalances,
 *     bankAccounts, bankTransactions, bankRules, bankReconciliations,
 *     bankReconciliationMatches, attachments, auditLogs, notifications,
 *     projects, budgets, recurring, departments, employees, leaveTypes,
 *     leaveRequests, leaveBalanceAdjustments, payRuns
 */

export const db: Firestore = firestore;

/** New document id. Postgres cuids are preserved on import; new rows use this. */
export function newId(): string {
  return randomUUID();
}

// ── Path builders ────────────────────────────────────────────────────────────

export function companyRef(companyId: string): DocumentReference {
  return db.collection("companies").doc(companyId);
}

/** A tenant-owned subcollection, e.g. sub("c123", "invoices"). */
export function sub(companyId: string, name: string): CollectionReference {
  return companyRef(companyId).collection(name);
}

/** A top-level (platform) collection. */
export function top(name: string): CollectionReference {
  return db.collection(name);
}

// ── Time ─────────────────────────────────────────────────────────────────────
//
// Prisma handed the app `Date`. Firestore stores `Timestamp`. Repositories
// convert at the boundary so nothing above them ever sees a Timestamp.

export function toTimestamp(d: Date | string | null | undefined): Timestamp | null {
  if (d == null) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Timestamp.fromDate(date);
}

export function fromTimestamp(t: Timestamp | null | undefined): Date | null {
  return t ? t.toDate() : null;
}

export const serverNow = FieldValue.serverTimestamp;

// ── Transactions ─────────────────────────────────────────────────────────────
//
// Replaces db.$transaction(fn). Firestore rules that callers must respect:
//   * every read (tx.get) must happen before every write in the callback;
//   * a single transaction commits at most 500 writes;
//   * the callback may run more than once on contention, so it must be pure
//     apart from the tx operations — no external side effects, no random ids
//     generated outside and captured by closure without care.
export type Tx = Transaction;

export function runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.runTransaction(fn);
}

// ── Query helpers ────────────────────────────────────────────────────────────

export interface Doc {
  id: string;
}

/** Map a QuerySnapshot to plain objects with `id`, running an optional decoder. */
export function mapDocs<T>(
  snap: FirebaseFirestore.QuerySnapshot,
  decode?: (raw: FirebaseFirestore.DocumentData, id: string) => T,
): T[] {
  return snap.docs.map((d) =>
    decode ? decode(d.data(), d.id) : ({ id: d.id, ...d.data() } as T),
  );
}

export { FieldValue, Timestamp };
