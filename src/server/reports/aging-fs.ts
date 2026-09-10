import "server-only";

/**
 * AR / AP aging and party statements (§12) — Firestore implementation.
 *
 * The subledger is built from invoices/bills + their allocations as of the
 * report date (a later payment must not reduce an earlier aging). `reconciliation`
 * compares that total against the GL control-account balance so drift is visible.
 */

import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { daysBetween } from "@/lib/dates";
import { getSystemAccount } from "@/server/db/accounts";
import { sub, toTimestamp } from "@/server/db/firestore";
import { getEntry } from "@/server/db/journal-entries";
import { invoices } from "@/server/db/invoices";
import { bills } from "@/server/db/bills";
import { creditNotes } from "@/server/db/credit-notes";
import { listPayments } from "@/server/db/payments";
import { getCustomer } from "@/server/db/customers";
import { getVendor } from "@/server/db/vendors";
import {
  listAllocationsForBill,
  listAllocationsForInvoice,
} from "@/server/db/payment-allocations";
import { accountRawBalanceAsOf } from "./ledger-fs";

export const DEFAULT_BUCKETS = [30, 60, 90] as const;

export interface AgingRow {
  partyId: string;
  partyName: string;
  email: string | null;
  currentCents: number;
  buckets: number[];
  overdueCents: number;
  totalCents: number;
  oldestDays: number;
  documents: {
    id: string;
    number: string;
    date: Date;
    dueDate: Date;
    balanceCents: number;
    daysOverdue: number;
    status: string;
  }[];
}

function bucketIndex(daysOverdue: number, buckets: readonly number[]): number {
  if (daysOverdue <= 0) return -1;
  for (let i = 0; i < buckets.length; i++) if (daysOverdue <= buckets[i]) return i;
  return buckets.length;
}

interface FlatDocument {
  partyId: string;
  partyName: string;
  email: string | null;
  id: string;
  number: string;
  date: Date;
  dueDate: Date;
  balanceCents: number;
  status: string;
}

function buildRows(documents: FlatDocument[], asOf: Date, buckets: readonly number[]): AgingRow[] {
  const byParty = new Map<string, AgingRow>();
  for (const doc of documents) {
    let row = byParty.get(doc.partyId);
    if (!row) {
      row = {
        partyId: doc.partyId,
        partyName: doc.partyName,
        email: doc.email,
        currentCents: 0,
        buckets: new Array(buckets.length + 1).fill(0),
        overdueCents: 0,
        totalCents: 0,
        oldestDays: 0,
        documents: [],
      };
      byParty.set(doc.partyId, row);
    }
    const daysOverdue = daysBetween(doc.dueDate, asOf);
    const index = bucketIndex(daysOverdue, buckets);
    if (index === -1) row.currentCents += doc.balanceCents;
    else {
      row.buckets[index] += doc.balanceCents;
      row.overdueCents += doc.balanceCents;
    }
    row.totalCents += doc.balanceCents;
    row.oldestDays = Math.max(row.oldestDays, daysOverdue);
    row.documents.push({
      id: doc.id,
      number: doc.number,
      date: doc.date,
      dueDate: doc.dueDate,
      balanceCents: doc.balanceCents,
      daysOverdue,
      status: doc.status,
    });
  }
  return [...byParty.values()];
}

function totalsOf(rows: AgingRow[], buckets: readonly number[]) {
  return {
    currentCents: rows.reduce((s, r) => s + r.currentCents, 0),
    buckets: new Array(buckets.length + 1)
      .fill(0)
      .map((_, i) => rows.reduce((s, r) => s + r.buckets[i], 0)),
    overdueCents: rows.reduce((s, r) => s + r.overdueCents, 0),
    totalCents: rows.reduce((s, r) => s + r.totalCents, 0),
  };
}

async function controlBalance(
  companyId: string,
  systemKey: string,
  asOf: Date,
): Promise<number> {
  const account = await getSystemAccount(companyId, systemKey);
  if (!account) return 0;
  const raw = await accountRawBalanceAsOf(companyId, account.id, asOf);
  return systemKey === SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE ? raw : -raw;
}

export async function arAging(
  companyId: string,
  asOf: Date,
  buckets: readonly number[] = DEFAULT_BUCKETS,
) {
  const all = await invoices.list(companyId, { orderBy: "dueDate" });
  const candidates = all.filter(
    (i) => i.status !== "DRAFT" && i.status !== "VOID" && i.issueDate <= asOf,
  );

  const outstanding: FlatDocument[] = [];
  for (const i of candidates) {
    const allocs = await listAllocationsForInvoice(companyId, i.id);
    const settled = allocs.filter((a) => a.date <= asOf).reduce((s, a) => s + a.amountCents, 0);
    const bal = i.totalCents - settled;
    if (bal <= 0) continue;
    const customer = await getCustomer(companyId, i.customerId);
    outstanding.push({
      partyId: i.customerId,
      partyName: customer?.name ?? "—",
      email: customer?.email ?? null,
      id: i.id,
      number: i.number,
      date: i.issueDate,
      dueDate: i.dueDate,
      balanceCents: bal,
      status: i.status,
    });
  }

  const rows = buildRows(outstanding, asOf, buckets);

  // Unapplied receipts + open customer credit notes are real A/R credits.
  const unapplied = (await listPayments(companyId, { type: "RECEIPT" })).filter(
    (p) => p.status === "POSTED" && p.unappliedCents > 0 && p.date <= asOf,
  );
  const openCredits = (await creditNotes.list(companyId, { where: [["type", "==", "CUSTOMER"]] })).filter(
    (c) => c.status !== "DRAFT" && c.status !== "VOID" && c.balanceCents > 0 && c.issueDate <= asOf,
  );

  const credits: { partyId: string; number: string; date: Date; amountCents: number }[] = [
    ...unapplied
      .filter((p) => p.customerId)
      .map((p) => ({ partyId: p.customerId!, number: `${p.number} (unapplied)`, date: p.date, amountCents: p.unappliedCents })),
    ...openCredits
      .filter((c) => c.customerId)
      .map((c) => ({ partyId: c.customerId!, number: `${c.number} (credit)`, date: c.issueDate, amountCents: c.balanceCents })),
  ];

  for (const credit of credits) {
    let row = rows.find((r) => r.partyId === credit.partyId);
    if (!row) {
      const customer = await getCustomer(companyId, credit.partyId);
      row = {
        partyId: credit.partyId,
        partyName: customer?.name ?? "—",
        email: customer?.email ?? null,
        currentCents: 0,
        buckets: new Array(buckets.length + 1).fill(0),
        overdueCents: 0,
        totalCents: 0,
        oldestDays: 0,
        documents: [],
      };
      rows.push(row);
    }
    row.currentCents -= credit.amountCents;
    row.totalCents -= credit.amountCents;
    row.documents.push({
      id: credit.number,
      number: credit.number,
      date: credit.date,
      dueDate: credit.date,
      balanceCents: -credit.amountCents,
      daysOverdue: 0,
      status: "CREDIT",
    });
  }

  const control = await controlBalance(companyId, SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE, asOf);
  const subledgerTotalCents = rows.reduce((s, r) => s + r.totalCents, 0);

  return {
    asOf,
    buckets,
    rows: rows.sort((a, b) => b.totalCents - a.totalCents),
    totals: totalsOf(rows, buckets),
    reconciliation: {
      subledgerTotalCents,
      controlAccountCents: control,
      differenceCents: subledgerTotalCents - control,
      reconciled: subledgerTotalCents === control,
    },
  };
}

export async function apAging(
  companyId: string,
  asOf: Date,
  buckets: readonly number[] = DEFAULT_BUCKETS,
) {
  const all = await bills.list(companyId, { orderBy: "dueDate" });
  const candidates = all.filter(
    (b) =>
      !["DRAFT", "AWAITING_APPROVAL", "VOID"].includes(b.status) && b.issueDate <= asOf,
  );

  const outstanding: FlatDocument[] = [];
  for (const b of candidates) {
    const allocs = await listAllocationsForBill(companyId, b.id);
    const settled = allocs.filter((a) => a.date <= asOf).reduce((s, a) => s + a.amountCents, 0);
    const bal = b.totalCents - settled;
    if (bal <= 0) continue;
    const vendor = await getVendor(companyId, b.vendorId);
    outstanding.push({
      partyId: b.vendorId,
      partyName: vendor?.name ?? "—",
      email: vendor?.email ?? null,
      id: b.id,
      number: b.number,
      date: b.issueDate,
      dueDate: b.dueDate,
      balanceCents: bal,
      status: b.status,
    });
  }

  const rows = buildRows(outstanding, asOf, buckets);

  const openCredits = (await creditNotes.list(companyId, { where: [["type", "==", "VENDOR"]] })).filter(
    (c) => c.status !== "DRAFT" && c.status !== "VOID" && c.balanceCents > 0 && c.issueDate <= asOf,
  );
  for (const credit of openCredits) {
    if (!credit.vendorId) continue;
    let row = rows.find((r) => r.partyId === credit.vendorId);
    if (!row) {
      const vendor = await getVendor(companyId, credit.vendorId);
      row = {
        partyId: credit.vendorId,
        partyName: vendor?.name ?? "—",
        email: vendor?.email ?? null,
        currentCents: 0,
        buckets: new Array(buckets.length + 1).fill(0),
        overdueCents: 0,
        totalCents: 0,
        oldestDays: 0,
        documents: [],
      };
      rows.push(row);
    }
    row.currentCents -= credit.balanceCents;
    row.totalCents -= credit.balanceCents;
    row.documents.push({
      id: credit.id,
      number: `${credit.number} (credit)`,
      date: credit.issueDate,
      dueDate: credit.issueDate,
      balanceCents: -credit.balanceCents,
      daysOverdue: 0,
      status: "CREDIT",
    });
  }

  const control = await controlBalance(companyId, SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE, asOf);
  const subledgerTotalCents = rows.reduce((s, r) => s + r.totalCents, 0);

  return {
    asOf,
    buckets,
    rows: rows.sort((a, b) => b.totalCents - a.totalCents),
    totals: totalsOf(rows, buckets),
    reconciliation: {
      subledgerTotalCents,
      controlAccountCents: control,
      differenceCents: subledgerTotalCents - control,
      reconciled: subledgerTotalCents === control,
    },
  };
}

export function bucketLabels(buckets: readonly number[]): string[] {
  const labels = ["Current"];
  let previous = 0;
  for (const bucket of buckets) {
    labels.push(`${previous + 1}–${bucket} days`);
    previous = bucket;
  }
  labels.push(`${previous + 1}+ days`);
  return labels;
}

/** Customer or vendor statement: opening, activity, payments, closing (§12). */
export async function partyStatement(
  companyId: string,
  party: { customerId?: string; vendorId?: string },
  from: Date,
  to: Date,
) {
  const isCustomer = Boolean(party.customerId);
  const partyId = party.customerId ?? party.vendorId!;
  const control = isCustomer
    ? SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE
    : SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE;
  const account = await getSystemAccount(companyId, control);
  if (!account) throw new Error("Control account not configured.");
  const partyField = isCustomer ? "customerId" : "vendorId";

  const [beforeSnap, inRangeSnap] = await Promise.all([
    sub(companyId, "journalLines")
      .where("accountId", "==", account.id)
      .where("date", "<", toTimestamp(from))
      .get(),
    sub(companyId, "journalLines")
      .where("accountId", "==", account.id)
      .where("date", ">=", toTimestamp(from))
      .where("date", "<=", toTimestamp(to))
      .get(),
  ]);

  const sign = (d: number, c: number) => (isCustomer ? d - c : c - d);

  interface PsLine {
    id: string;
    journalEntryId: string;
    lineNo: number;
    date: Date;
    debitCents: number;
    creditCents: number;
    description: string | null;
  }
  const forParty = (raw: FirebaseFirestore.DocumentData) => raw[partyField] === partyId;
  const toLine = (d: FirebaseFirestore.QueryDocumentSnapshot): PsLine => {
    const raw = d.data();
    return {
      id: d.id,
      journalEntryId: raw.journalEntryId,
      lineNo: raw.lineNo ?? 0,
      date: (raw.date as FirebaseFirestore.Timestamp).toDate(),
      debitCents: raw.debitCents ?? 0,
      creditCents: raw.creditCents ?? 0,
      description: raw.description ?? null,
    };
  };

  const openingCents = beforeSnap.docs
    .filter((d) => forParty(d.data()))
    .map(toLine)
    .reduce((s, l) => s + sign(l.debitCents, l.creditCents), 0);

  const lines = inRangeSnap.docs
    .filter((d) => forParty(d.data()))
    .map(toLine)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.lineNo - b.lineNo);

  let running = openingCents;
  const rows = [];
  for (const line of lines) {
    const movement = sign(line.debitCents, line.creditCents);
    running += movement;
    const entry = await getEntry(companyId, line.journalEntryId);
    rows.push({
      ...line,
      journalEntry: entry
        ? {
            entryNo: entry.entryNo,
            sourceType: entry.sourceType,
            sourceNumber: entry.sourceNumber,
            memo: entry.memo,
          }
        : null,
      movementCents: movement,
      runningBalanceCents: running,
    });
  }

  const entity = isCustomer
    ? await getCustomer(companyId, partyId)
    : await getVendor(companyId, partyId);

  return { entity, openingCents, rows, closingCents: running, from, to };
}
