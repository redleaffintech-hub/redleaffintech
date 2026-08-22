/**
 * AR / AP aging and party statements (spec §12).
 *
 * Acceptance criterion (§35): "AR aging reconciles to the AR control account."
 * `reconciliation` on each result compares the subledger total against the GL
 * control-account balance and reports the gap, so a drift is visible in the UI
 * instead of being discovered at year-end.
 */

import { db } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { daysBetween } from "@/lib/dates";

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
  for (let i = 0; i < buckets.length; i++) {
    if (daysOverdue <= buckets[i]) return i;
  }
  return buckets.length;
}

export async function arAging(
  companyId: string,
  asOf: Date,
  buckets: readonly number[] = DEFAULT_BUCKETS,
) {
  const invoices = await db.invoice.findMany({
    where: {
      companyId,
      status: { notIn: ["DRAFT", "VOID"] },
      issueDate: { lte: asOf },
    },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      allocations: { select: { amountCents: true, date: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  /**
   * The balance AS OF the report date, not the stored current balance: a
   * payment received after `asOf` must not reduce an earlier aging, or the
   * subledger stops tying to the control account on back-dated reports.
   */
  const outstanding = invoices
    .map((i) => ({
      ...i,
      asOfBalanceCents:
        i.totalCents - i.allocations.filter((a) => a.date <= asOf).reduce((s, a) => s + a.amountCents, 0),
    }))
    .filter((i) => i.asOfBalanceCents > 0);

  // Unapplied receipts and open credit notes are real credits sitting in the
  // A/R control account. Omitting them overstates the subledger.
  const unapplied = await db.payment.findMany({
    where: { companyId, type: "RECEIPT", status: "POSTED", unappliedCents: { gt: 0 }, date: { lte: asOf } },
    include: { customer: { select: { id: true, name: true, email: true } } },
  });
  const openCredits = await db.creditNote.findMany({
    where: { companyId, type: "CUSTOMER", status: { notIn: ["DRAFT", "VOID"] }, balanceCents: { gt: 0 }, issueDate: { lte: asOf } },
    include: { customer: { select: { id: true, name: true, email: true } } },
  });

  const rows = buildRows(
    outstanding.map((i) => ({
      partyId: i.customer.id,
      partyName: i.customer.name,
      email: i.customer.email,
      id: i.id,
      number: i.number,
      date: i.issueDate,
      dueDate: i.dueDate,
      balanceCents: i.asOfBalanceCents,
      status: i.status,
    })),
    asOf,
    buckets,
  );

  const credits = [
    ...unapplied
      .filter((p) => p.customer)
      .map((p) => ({ party: p.customer!, id: p.id, number: `${p.number} (unapplied)`, date: p.date, amountCents: p.unappliedCents })),
    ...openCredits
      .filter((c) => c.customer)
      .map((c) => ({ party: c.customer!, id: c.id, number: `${c.number} (credit)`, date: c.issueDate, amountCents: c.balanceCents })),
  ];

  for (const credit of credits) {
    let row = rows.find((r) => r.partyId === credit.party.id);
    if (!row) {
      row = {
        partyId: credit.party.id,
        partyName: credit.party.name,
        email: credit.party.email,
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
      id: credit.id,
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
  const bills = await db.bill.findMany({
    where: {
      companyId,
      status: { notIn: ["DRAFT", "AWAITING_APPROVAL", "VOID"] },
      issueDate: { lte: asOf },
    },
    include: {
      vendor: { select: { id: true, name: true, email: true } },
      allocations: { select: { amountCents: true, date: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const outstanding = bills
    .map((b) => ({
      ...b,
      asOfBalanceCents:
        b.totalCents - b.allocations.filter((a) => a.date <= asOf).reduce((s, a) => s + a.amountCents, 0),
    }))
    .filter((b) => b.asOfBalanceCents > 0);

  const openCredits = await db.creditNote.findMany({
    where: { companyId, type: "VENDOR", status: { notIn: ["DRAFT", "VOID"] }, balanceCents: { gt: 0 }, issueDate: { lte: asOf } },
    include: { vendor: { select: { id: true, name: true, email: true } } },
  });

  const rows = buildRows(
    outstanding.map((b) => ({
      partyId: b.vendor.id,
      partyName: b.vendor.name,
      email: b.vendor.email,
      id: b.id,
      number: b.number,
      date: b.issueDate,
      dueDate: b.dueDate,
      balanceCents: b.asOfBalanceCents,
      status: b.status,
    })),
    asOf,
    buckets,
  );

  for (const credit of openCredits) {
    if (!credit.vendor) continue;
    let row = rows.find((r) => r.partyId === credit.vendor!.id);
    if (!row) {
      row = {
        partyId: credit.vendor.id, partyName: credit.vendor.name, email: credit.vendor.email,
        currentCents: 0, buckets: new Array(buckets.length + 1).fill(0),
        overdueCents: 0, totalCents: 0, oldestDays: 0, documents: [],
      };
      rows.push(row);
    }
    row.currentCents -= credit.balanceCents;
    row.totalCents -= credit.balanceCents;
    row.documents.push({
      id: credit.id, number: `${credit.number} (credit)`, date: credit.issueDate,
      dueDate: credit.issueDate, balanceCents: -credit.balanceCents, daysOverdue: 0, status: "CREDIT",
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

async function controlBalance(companyId: string, systemKey: string, asOf: Date): Promise<number> {
  const account = await db.account.findFirst({ where: { companyId, systemKey } });
  if (!account) return 0;
  const result = await db.journalLine.aggregate({
    where: { companyId, accountId: account.id, date: { lte: asOf } },
    _sum: { debitCents: true, creditCents: true },
  });
  const debit = result._sum.debitCents ?? 0;
  const credit = result._sum.creditCents ?? 0;
  // AR is a debit-natural asset; AP is credit-natural.
  return systemKey === SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE ? debit - credit : credit - debit;
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
  const where = party.customerId
    ? { companyId, customerId: party.customerId }
    : { companyId, vendorId: party.vendorId };

  const control = party.customerId ? SYSTEM_ACCOUNTS.ACCOUNTS_RECEIVABLE : SYSTEM_ACCOUNTS.ACCOUNTS_PAYABLE;
  const account = await db.account.findFirst({ where: { companyId, systemKey: control } });
  if (!account) throw new Error("Control account not configured.");

  const opening = await db.journalLine.aggregate({
    where: { ...where, accountId: account.id, date: { lt: from } },
    _sum: { debitCents: true, creditCents: true },
  });
  const openingCents = party.customerId
    ? (opening._sum.debitCents ?? 0) - (opening._sum.creditCents ?? 0)
    : (opening._sum.creditCents ?? 0) - (opening._sum.debitCents ?? 0);

  const lines = await db.journalLine.findMany({
    where: { ...where, accountId: account.id, date: { gte: from, lte: to } },
    include: { journalEntry: { select: { entryNo: true, sourceType: true, sourceNumber: true, memo: true } } },
    orderBy: [{ date: "asc" }, { lineNo: "asc" }],
  });

  let running = openingCents;
  const rows = lines.map((line) => {
    const movement = party.customerId
      ? line.debitCents - line.creditCents
      : line.creditCents - line.debitCents;
    running += movement;
    return { ...line, movementCents: movement, runningBalanceCents: running };
  });

  const entity = party.customerId
    ? await db.customer.findFirst({ where: { id: party.customerId, companyId } })
    : await db.vendor.findFirst({ where: { id: party.vendorId, companyId } });

  return { entity, openingCents, rows, closingCents: running, from, to };
}
