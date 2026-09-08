/**
 * Monthly bank reconciliation (spec §11, §12 Bank Reconciliation report).
 *
 * One reconciliation per bank account per calendar month. The workspace shows
 * two independent panels — the imported bank statement and the posted bank
 * ledger — and the reconciler ties them together with matches. A reconciliation
 * completes only when
 *
 *   1. statement opening + statement movement = statement closing, and
 *   2. every statement transaction on or before the period end is matched, and
 *   3. adjusted bank balance − book balance = 0
 *
 * On completion the month-end report is frozen: later activity that clears an
 * item outstanding this month is matched in a future month and never rewrites
 * the historical report.
 */

import { db, type Tx } from "@/lib/db";
import { startOfMonth, endOfMonth, isoDate, formatMonthLong, addMonths } from "@/lib/dates";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReconciliationSummary {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  currency: string;
  year: number;
  month: number;
  periodStartIso: string;
  periodEndIso: string;
  monthLabel: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  bookBalanceCents: number;
  statementMovementCents: number;
  outstandingReceiptsCents: number;
  outstandingPaymentsCents: number;
  adjustedBankBalanceCents: number;
  differenceCents: number;
  status: string;
  version: number;
  lockedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  statementBalanceValid: boolean;
  allStatementMatched: boolean;
  canComplete: boolean;
}

export interface WorkspaceRow {
  key: string;
  date: string;
  description: string;
  sublabel: string | null;
  drCents: number;
  crCents: number;
  matchId: string | null;
  lockedElsewhere: boolean;
  prior: boolean;
}

export interface MonthEndReport {
  asOfIso: string;
  currency: string;
  bankAccountName: string;
  monthLabel: string;
  nextMonthLabel: string;
  statementClosingCents: number;
  outstandingReceipts: { date: string; description: string; amountCents: number }[];
  outstandingPayments: { date: string; description: string; amountCents: number }[];
  outstandingReceiptsCents: number;
  outstandingPaymentsCents: number;
  adjustedBankBalanceCents: number;
  bookBalanceCents: number;
  differenceCents: number;
  unmatchedStatementItems: { date: string; description: string; amountCents: number }[];
  balanced: boolean;
  frozen: boolean;
}

export interface ReconciliationWorkspace {
  summary: ReconciliationSummary;
  statementRows: WorkspaceRow[];
  bookRows: WorkspaceRow[];
  matches: { id: string; netCents: number; statementTxnIds: string[]; bookLineIds: string[] }[];
  report: MonthEndReport;
}

// ── Guards ─────────────────────────────────────────────────────────────────

async function loadBankAccount(companyId: string, bankAccountId: string) {
  const bankAccount = await db.bankAccount.findFirst({
    where: { id: bankAccountId, companyId },
  });
  if (!bankAccount) throw new Error("Bank account not found in this company.");
  return bankAccount;
}

function assertMonth(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Invalid statement year.");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Invalid statement month.");
}

// ── Start / resume ─────────────────────────────────────────────────────────

/** The reconciliation for one account and month, resuming an existing one. */
export async function getOrStartReconciliation(
  companyId: string,
  input: { bankAccountId: string; year: number; month: number },
  userId?: string | null,
) {
  assertMonth(input.year, input.month);
  const bankAccount = await loadBankAccount(companyId, input.bankAccountId);

  const existing = await db.bankReconciliation.findFirst({
    where: {
      companyId,
      bankAccountId: input.bankAccountId,
      statementYear: input.year,
      statementMonth: input.month,
    },
  });
  if (existing) return existing;

  const periodStart = startOfMonth(new Date(Date.UTC(input.year, input.month - 1, 1)));
  const periodEnd = endOfMonth(periodStart);

  // Carry the opening balance forward from the most recent completed
  // reconciliation of this account, or from the account's own opening figure.
  const priorCompleted = await db.bankReconciliation.findFirst({
    where: { companyId, bankAccountId: input.bankAccountId, status: "COMPLETED" },
    orderBy: { statementEndDate: "desc" },
  });
  const openingBalanceCents = priorCompleted
    ? priorCompleted.closingBalanceCents
    : bankAccount.openingBalanceCents;

  // The unique constraint on (company, account, year, month) is the real guard
  // against duplicate/overlapping reconciliations; a race just resolves to the
  // row the loser then reads back.
  try {
    return await db.bankReconciliation.create({
      data: {
        companyId,
        bankAccountId: input.bankAccountId,
        statementYear: input.year,
        statementMonth: input.month,
        statementStartDate: periodStart,
        statementEndDate: periodEnd,
        openingBalanceCents,
        closingBalanceCents: openingBalanceCents,
        startedById: userId ?? null,
      },
    });
  } catch {
    const raced = await db.bankReconciliation.findFirst({
      where: {
        companyId,
        bankAccountId: input.bankAccountId,
        statementYear: input.year,
        statementMonth: input.month,
      },
    });
    if (raced) return raced;
    throw new Error("Could not start the reconciliation.");
  }
}

/** Save the statement figures while a reconciliation is still in progress. */
export async function saveStatementBalances(
  companyId: string,
  reconciliationId: string,
  input: { openingBalanceCents: number; closingBalanceCents: number; notes?: string | null },
) {
  const reconciliation = await db.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId },
  });
  if (!reconciliation) throw new Error("Reconciliation not found in this company.");
  if (reconciliation.status !== "IN_PROGRESS") throw new Error("This reconciliation is completed and locked.");

  await db.bankReconciliation.update({
    where: { id: reconciliationId },
    data: {
      openingBalanceCents: input.openingBalanceCents,
      closingBalanceCents: input.closingBalanceCents,
      notes: input.notes ?? null,
    },
  });
  return persistSummary(db, companyId, reconciliationId);
}

// ── Matching ───────────────────────────────────────────────────────────────

/** Every statement-txn id and book-line id already consumed by a match, split
 *  into "any" and "consumed by a COMPLETED reconciliation" (never reusable). */
async function loadConsumed(client: Tx, companyId: string, bankAccountId: string) {
  const matches = await client.bankReconciliationMatch.findMany({
    where: { companyId, bankAccountId },
    include: { reconciliation: { select: { status: true } } },
  });
  const anyTxn = new Set<string>();
  const anyLine = new Set<string>();
  const completedTxn = new Set<string>();
  const completedLine = new Set<string>();
  for (const m of matches) {
    for (const id of m.statementTxnIds) {
      anyTxn.add(id);
      if (m.reconciliation.status === "COMPLETED") completedTxn.add(id);
    }
    for (const id of m.bookLineIds) {
      anyLine.add(id);
      if (m.reconciliation.status === "COMPLETED") completedLine.add(id);
    }
  }
  return { anyTxn, anyLine, completedTxn, completedLine };
}

/**
 * Tie statement transaction(s) to bank-ledger journal line(s). Supports 1:1 and
 * equal-total grouped matches. Never posts anything — it only records that an
 * existing bank line and an existing book entry are the same movement of money.
 */
export async function matchSelected(
  companyId: string,
  reconciliationId: string,
  statementTxnIds: string[],
  bookLineIds: string[],
  userId?: string | null,
) {
  return db.$transaction(async (tx) => {
    const reconciliation = await tx.bankReconciliation.findFirst({
      where: { id: reconciliationId, companyId },
      include: { bankAccount: true },
    });
    if (!reconciliation) throw new Error("Reconciliation not found in this company.");
    if (reconciliation.status !== "IN_PROGRESS") throw new Error("This reconciliation is completed and locked.");
    if (statementTxnIds.length === 0 || bookLineIds.length === 0) {
      throw new Error("Select at least one statement line and one book entry.");
    }

    const txns = await tx.bankTransaction.findMany({
      where: {
        id: { in: statementTxnIds },
        companyId,
        bankAccountId: reconciliation.bankAccountId,
        status: { notIn: ["EXCLUDED", "RECONCILED"] },
      },
    });
    if (txns.length !== statementTxnIds.length) {
      throw new Error("A selected statement line is missing, excluded or already reconciled.");
    }

    const lines = await tx.journalLine.findMany({
      where: {
        id: { in: bookLineIds },
        companyId,
        accountId: reconciliation.bankAccount.accountId,
        journalEntry: { status: "POSTED", reversalOfId: null },
      },
    });
    if (lines.length !== bookLineIds.length) {
      throw new Error("A selected book entry is missing or does not post to this bank account.");
    }

    const consumed = await loadConsumed(tx, companyId, reconciliation.bankAccountId);
    for (const id of statementTxnIds) {
      if (consumed.completedTxn.has(id)) throw new Error("A selected statement line was reconciled in a completed period.");
      if (consumed.anyTxn.has(id)) throw new Error("A selected statement line is already matched.");
    }
    for (const id of bookLineIds) {
      if (consumed.completedLine.has(id)) throw new Error("A selected book entry was reconciled in a completed period.");
      if (consumed.anyLine.has(id)) throw new Error("A selected book entry is already matched.");
    }

    // Statement net cash: + = deposit. Book net cash: debit − credit = + into the bank ledger.
    const stmtNet = txns.reduce((s, t) => s + t.amountCents, 0);
    const bookNet = lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    if (stmtNet === 0 || bookNet === 0) throw new Error("A match cannot net to zero.");
    if (stmtNet !== bookNet) {
      throw new Error(
        `Totals do not agree: statement ${(stmtNet / 100).toFixed(2)} vs books ${(bookNet / 100).toFixed(2)}. A deposit is a statement credit and a bank-ledger debit of the same amount.`,
      );
    }

    await tx.bankReconciliationMatch.create({
      data: {
        companyId,
        reconciliationId,
        bankAccountId: reconciliation.bankAccountId,
        netCents: stmtNet,
        statementTxnIds,
        bookLineIds,
        createdById: userId ?? null,
      },
    });

    // Take the statement lines out of the review queue while they sit in a match.
    await tx.bankTransaction.updateMany({
      where: { id: { in: statementTxnIds }, companyId },
      data: { reconciliationId },
    });

    return persistSummary(tx, companyId, reconciliationId);
  });
}

/** Remove a match. Only permitted while the reconciliation is in progress. */
export async function removeMatch(companyId: string, reconciliationId: string, matchId: string) {
  return db.$transaction(async (tx) => {
    const reconciliation = await tx.bankReconciliation.findFirst({
      where: { id: reconciliationId, companyId },
    });
    if (!reconciliation) throw new Error("Reconciliation not found in this company.");
    if (reconciliation.status !== "IN_PROGRESS") {
      throw new Error("A completed reconciliation is locked — its matches cannot be removed.");
    }
    const match = await tx.bankReconciliationMatch.findFirst({
      where: { id: matchId, companyId, reconciliationId },
    });
    if (!match) throw new Error("Match not found in this reconciliation.");

    await tx.bankReconciliationMatch.delete({ where: { id: matchId } });
    await tx.bankTransaction.updateMany({
      where: { id: { in: match.statementTxnIds }, companyId, status: { not: "RECONCILED" } },
      data: { reconciliationId: null },
    });

    return persistSummary(tx, companyId, reconciliationId);
  });
}

// ── Workspace + report ─────────────────────────────────────────────────────

/** The bank ledger balance, over exactly the lines the book panel shows so the
 *  two never disagree: posted entries, reversal pairs excluded. */
async function bankBookBalanceCents(client: Tx, companyId: string, accountId: string, asOf: Date) {
  const result = await client.journalLine.aggregate({
    where: {
      companyId,
      accountId,
      date: { lte: asOf },
      journalEntry: { status: "POSTED", reversalOfId: null },
    },
    _sum: { debitCents: true, creditCents: true },
  });
  return (result._sum.debitCents ?? 0) - (result._sum.creditCents ?? 0);
}

/** Everything the reconcile page renders for one reconciliation. */
export async function buildWorkspace(
  companyId: string,
  reconciliationId: string,
  client: Tx = db,
): Promise<ReconciliationWorkspace> {
  const reconciliation = await client.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId },
    include: { bankAccount: { include: { account: true } }, matches: true },
  });
  if (!reconciliation) throw new Error("Reconciliation not found in this company.");

  const periodStart = reconciliation.statementStartDate;
  const periodEnd = reconciliation.statementEndDate;
  const glAccountId = reconciliation.bankAccount.accountId;
  const currency = reconciliation.bankAccount.currency;

  const [statementTxns, bookLines, consumed] = await Promise.all([
    client.bankTransaction.findMany({
      where: {
        companyId,
        bankAccountId: reconciliation.bankAccountId,
        date: { lte: periodEnd },
        status: { notIn: ["EXCLUDED"] },
      },
      orderBy: { date: "asc" },
    }),
    client.journalLine.findMany({
      where: {
        companyId,
        accountId: glAccountId,
        date: { lte: periodEnd },
        journalEntry: { status: "POSTED", reversalOfId: null },
      },
      include: { journalEntry: { select: { entryNo: true, memo: true, sourceNumber: true } } },
      orderBy: [{ date: "asc" }, { lineNo: "asc" }],
    }),
    loadConsumed(client, companyId, reconciliation.bankAccountId),
  ]);

  const matchOfTxn = new Map<string, string>();
  const matchOfLine = new Map<string, string>();
  for (const m of reconciliation.matches) {
    for (const id of m.statementTxnIds) matchOfTxn.set(id, m.id);
    for (const id of m.bookLineIds) matchOfLine.set(id, m.id);
  }

  const statementRows: WorkspaceRow[] = statementTxns
    .filter((t) => !consumed.completedTxn.has(t.id) || matchOfTxn.has(t.id))
    .filter((t) => t.status !== "RECONCILED" || matchOfTxn.has(t.id))
    .map((t) => ({
      key: t.id,
      date: isoDate(t.date),
      description: t.description,
      sublabel: t.reference ?? null,
      // Statement (bank) perspective: a deposit is a credit, a withdrawal a debit.
      drCents: t.amountCents < 0 ? -t.amountCents : 0,
      crCents: t.amountCents > 0 ? t.amountCents : 0,
      matchId: matchOfTxn.get(t.id) ?? null,
      lockedElsewhere: consumed.completedTxn.has(t.id),
      prior: t.date < periodStart,
    }));

  const bookRows: WorkspaceRow[] = bookLines
    .filter((l) => !consumed.completedLine.has(l.id) || matchOfLine.has(l.id))
    .map((l) => ({
      key: l.id,
      date: isoDate(l.date),
      description: l.description ?? l.journalEntry.memo ?? "Journal entry",
      sublabel: l.journalEntry.sourceNumber ?? l.journalEntry.entryNo,
      drCents: l.debitCents,
      crCents: l.creditCents,
      matchId: matchOfLine.get(l.id) ?? null,
      lockedElsewhere: consumed.completedLine.has(l.id),
      prior: l.date < periodStart,
    }));

  // Statement movement is this period's activity only.
  const statementMovementCents = statementTxns
    .filter((t) => t.date >= periodStart && t.date <= periodEnd)
    .reduce((s, t) => s + t.amountCents, 0);

  const bookBalanceCents =
    reconciliation.status === "COMPLETED" && reconciliation.bookBalanceCents != null
      ? reconciliation.bookBalanceCents
      : await bankBookBalanceCents(client, companyId, glAccountId, periodEnd);

  // Outstanding = book entries on or before the period end that are in no match.
  const outstandingBookRows = bookRows.filter((r) => r.matchId === null);
  const outstandingReceipts = outstandingBookRows
    .filter((r) => r.drCents > 0)
    .map((r) => ({ date: r.date, description: r.description, amountCents: r.drCents }));
  const outstandingPayments = outstandingBookRows
    .filter((r) => r.crCents > 0)
    .map((r) => ({ date: r.date, description: r.description, amountCents: r.crCents }));
  const outstandingReceiptsCents = outstandingReceipts.reduce((s, r) => s + r.amountCents, 0);
  const outstandingPaymentsCents = outstandingPayments.reduce((s, r) => s + r.amountCents, 0);

  // Statement lines with no book counterpart — these are NOT timing differences.
  const unmatchedStatementItems = statementRows
    .filter((r) => r.matchId === null)
    .map((r) => ({
      date: r.date,
      description: r.description,
      amountCents: r.crCents > 0 ? r.crCents : -r.drCents,
    }));

  // A completed reconciliation reads its financial figures from the frozen
  // snapshot; only an in-progress one recomputes them from live data.
  const completed = reconciliation.status === "COMPLETED";
  const outstandingReceiptsFinal = completed ? reconciliation.outstandingReceiptsCents : outstandingReceiptsCents;
  const outstandingPaymentsFinal = completed ? reconciliation.outstandingPaymentsCents : outstandingPaymentsCents;
  const adjustedBankBalanceCents = completed
    ? reconciliation.adjustedBankBalanceCents ?? reconciliation.closingBalanceCents + outstandingReceiptsFinal - outstandingPaymentsFinal
    : reconciliation.closingBalanceCents + outstandingReceiptsCents - outstandingPaymentsCents;
  const differenceCents = completed ? reconciliation.differenceCents : adjustedBankBalanceCents - bookBalanceCents;

  const statementBalanceValid =
    reconciliation.openingBalanceCents + statementMovementCents === reconciliation.closingBalanceCents;
  const allStatementMatched = statementRows.every((r) => r.matchId !== null);
  const canComplete =
    reconciliation.status === "IN_PROGRESS" &&
    statementBalanceValid &&
    allStatementMatched &&
    differenceCents === 0;

  const monthLabel = formatMonthLong(periodStart);
  const nextMonthLabel = formatMonthLong(addMonths(periodStart, 1));

  const liveReport: MonthEndReport = {
    asOfIso: isoDate(periodEnd),
    currency,
    bankAccountName: reconciliation.bankAccount.name,
    monthLabel,
    nextMonthLabel,
    statementClosingCents: reconciliation.closingBalanceCents,
    outstandingReceipts,
    outstandingPayments,
    outstandingReceiptsCents,
    outstandingPaymentsCents,
    adjustedBankBalanceCents,
    bookBalanceCents,
    differenceCents,
    unmatchedStatementItems,
    balanced: differenceCents === 0,
    frozen: false,
  };

  const report: MonthEndReport =
    reconciliation.status === "COMPLETED" && reconciliation.reportJson
      ? { ...(JSON.parse(reconciliation.reportJson) as MonthEndReport), frozen: true }
      : liveReport;

  const summary: ReconciliationSummary = {
    id: reconciliation.id,
    bankAccountId: reconciliation.bankAccountId,
    bankAccountName: reconciliation.bankAccount.name,
    currency,
    year: reconciliation.statementYear,
    month: reconciliation.statementMonth,
    periodStartIso: isoDate(periodStart),
    periodEndIso: isoDate(periodEnd),
    monthLabel,
    openingBalanceCents: reconciliation.openingBalanceCents,
    closingBalanceCents: reconciliation.closingBalanceCents,
    bookBalanceCents,
    statementMovementCents,
    outstandingReceiptsCents: outstandingReceiptsFinal,
    outstandingPaymentsCents: outstandingPaymentsFinal,
    adjustedBankBalanceCents,
    differenceCents,
    status: reconciliation.status,
    version: reconciliation.version,
    lockedAt: reconciliation.lockedAt ? reconciliation.lockedAt.toISOString() : null,
    completedAt: reconciliation.completedAt ? reconciliation.completedAt.toISOString() : null,
    notes: reconciliation.notes,
    statementBalanceValid,
    allStatementMatched,
    canComplete,
  };

  return {
    summary,
    statementRows,
    bookRows,
    matches: reconciliation.matches.map((m) => ({
      id: m.id,
      netCents: m.netCents,
      statementTxnIds: m.statementTxnIds,
      bookLineIds: m.bookLineIds,
    })),
    report,
  };
}

/** Recompute the stored balance snapshot on the reconciliation row. */
async function persistSummary(client: Tx, companyId: string, reconciliationId: string) {
  const { summary } = await buildWorkspace(companyId, reconciliationId, client);
  await client.bankReconciliation.update({
    where: { id: reconciliationId },
    data: {
      clearedBalanceCents: summary.adjustedBankBalanceCents,
      differenceCents: summary.differenceCents,
    },
  });
  return summary;
}

// ── Completion ─────────────────────────────────────────────────────────────

export async function completeReconciliation(
  companyId: string,
  reconciliationId: string,
  expectedVersion: number,
  userId: string,
) {
  return db.$transaction(async (tx) => {
    const workspace = await buildWorkspace(companyId, reconciliationId, tx);
    const { summary, report } = workspace;

    if (summary.status !== "IN_PROGRESS") throw new Error("This reconciliation is already completed.");
    if (!summary.statementBalanceValid) {
      throw new Error(
        "Statement opening plus statement movement does not equal the closing balance. Import the full statement or correct the figures.",
      );
    }
    if (!summary.allStatementMatched) {
      throw new Error(
        "Every statement transaction must be matched to a book entry before completing. Match the remaining lines or record an adjustment.",
      );
    }
    if (summary.differenceCents !== 0) {
      throw new Error(
        `Adjusted difference is ${(summary.differenceCents / 100).toFixed(2)}, not zero. Unexplained bank-only items must be posted as adjustments through the ledger, never treated as timing differences.`,
      );
    }

    // Atomic completion with an optimistic-concurrency check.
    const updated = await tx.bankReconciliation.updateMany({
      where: { id: reconciliationId, companyId, status: "IN_PROGRESS", version: expectedVersion },
      data: {
        status: "COMPLETED",
        version: { increment: 1 },
        completedAt: new Date(),
        completedById: userId,
        lockedAt: new Date(),
        clearedBalanceCents: summary.adjustedBankBalanceCents,
        differenceCents: 0,
        bookBalanceCents: summary.bookBalanceCents,
        outstandingReceiptsCents: summary.outstandingReceiptsCents,
        outstandingPaymentsCents: summary.outstandingPaymentsCents,
        adjustedBankBalanceCents: summary.adjustedBankBalanceCents,
        reportJson: JSON.stringify({ ...report, frozen: true }),
      },
    });
    if (updated.count !== 1) {
      throw new Error("This reconciliation was changed by someone else. Reload and try again.");
    }

    const statementTxnIds = workspace.matches.flatMap((m) => m.statementTxnIds);
    if (statementTxnIds.length > 0) {
      await tx.bankTransaction.updateMany({
        where: { id: { in: statementTxnIds }, companyId },
        data: { status: "RECONCILED", reconciliationId },
      });
    }

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: "UPDATE",
        entityType: "BankReconciliation",
        entityId: reconciliationId,
        summary: `Reconciled ${summary.bankAccountName} for ${report.monthLabel} — difference $0.00`,
      },
    });

    return tx.bankReconciliation.findUniqueOrThrow({ where: { id: reconciliationId } });
  });
}

// ── History ────────────────────────────────────────────────────────────────

export async function reconciliationHistory(companyId: string, bankAccountId?: string) {
  return db.bankReconciliation.findMany({
    where: { companyId, ...(bankAccountId ? { bankAccountId } : {}) },
    include: { bankAccount: true },
    orderBy: [{ statementEndDate: "desc" }, { bankAccount: { name: "asc" } }],
    take: 60,
  });
}
