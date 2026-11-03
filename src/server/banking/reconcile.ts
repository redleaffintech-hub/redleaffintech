/**
 * Bank reconciliation (spec §11, §12 Bank Reconciliation report).
 *
 * One reconciliation per bank account per reconciliation date. The workspace shows
 * two independent panels — the imported bank statement and the posted bank
 * ledger — and the reconciler ties them together with matches. A reconciliation
 * completes only when
 *
 *   1. statement opening + statement movement = statement closing, and
 *   2. adjusted bank balance − GL balance on the reconciliation date = 0
 *
 * Statement lines left unmatched are reported, not hidden; they cannot be closed
 * over because they leave the difference non-zero until the ledger is adjusted.
 *
 * On completion the report is frozen: later activity that clears an item
 * outstanding now is matched in a future reconciliation and never rewrites the
 * historical report.
 */

import { db, type Tx } from "@/lib/db";
import { startOfMonth, addDays, isoDate, formatDate, toUtcDay } from "@/lib/dates";
import { reconciliationBridge } from "@/lib/reconcile-summary";

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
  /** The date the reconciliation is performed as of (GL balance date). */
  statementDateIso: string;
  /** The closing date on the bank statement. */
  statementClosingDateIso: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  bookBalanceCents: number;
  statementMovementCents: number;
  statementCreditsCents: number;
  statementDebitsCents: number;
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

function assertDate(date: Date) {
  if (Number.isNaN(date.getTime())) throw new Error("Choose the reconciliation date.");
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) throw new Error("Invalid reconciliation date.");
}

// ── Start / resume ─────────────────────────────────────────────────────────

/** The most recent completed reconciliation of an account, for carry-forward. */
export async function lastCompletedReconciliation(companyId: string, bankAccountId: string) {
  return db.bankReconciliation.findFirst({
    where: { companyId, bankAccountId, status: "COMPLETED" },
    orderBy: { statementDate: "desc" },
  });
}

/**
 * The reconciliation for one account and date, resuming an existing one.
 *
 * The opening balance is whatever the caller passes; the screen pre-fills it from
 * the last completed reconciliation's closing balance and asks for it on the
 * first one. Without one it falls back to the same carry-forward, else zero.
 */
export async function getOrStartReconciliation(
  companyId: string,
  input: {
    bankAccountId: string;
    date: Date;
    openingBalanceCents?: number;
    closingBalanceCents?: number;
    closingDate?: Date | null;
  },
  userId?: string | null,
) {
  const date = toUtcDay(input.date);
  assertDate(date);
  await loadBankAccount(companyId, input.bankAccountId);

  const existing = await db.bankReconciliation.findFirst({
    where: { companyId, bankAccountId: input.bankAccountId, statementDate: date },
  });
  if (existing) return existing;

  const priorCompleted = await lastCompletedReconciliation(companyId, input.bankAccountId);
  if (priorCompleted && date <= priorCompleted.statementDate) {
    throw new Error(
      `This account was already reconciled up to ${formatDate(priorCompleted.statementDate)}. Choose a later date.`,
    );
  }

  // The statement period starts the day after the last completed reconciliation;
  // for the first one it starts at the beginning of that month.
  const periodStart = priorCompleted ? addDays(priorCompleted.statementDate, 1) : startOfMonth(date);

  const openingBalanceCents = input.openingBalanceCents ?? priorCompleted?.closingBalanceCents ?? 0;
  const closingDate = input.closingDate ? toUtcDay(input.closingDate) : null;
  if (closingDate) assertDate(closingDate);

  // The unique constraint on (company, account, date) is the real guard against
  // duplicates; a race just resolves to the row the loser then reads back.
  try {
    return await db.bankReconciliation.create({
      data: {
        companyId,
        bankAccountId: input.bankAccountId,
        statementYear: date.getUTCFullYear(),
        statementMonth: date.getUTCMonth() + 1,
        statementStartDate: periodStart,
        statementEndDate: date,
        statementDate: date,
        statementClosingDate: closingDate,
        openingBalanceCents,
        closingBalanceCents: input.closingBalanceCents ?? openingBalanceCents,
        startedById: userId ?? null,
      },
    });
  } catch {
    const raced = await db.bankReconciliation.findFirst({
      where: { companyId, bankAccountId: input.bankAccountId, statementDate: date },
    });
    if (raced) return raced;
    throw new Error("Could not start the reconciliation.");
  }
}

/** Save the statement figures while a reconciliation is still in progress. */
export async function saveStatementBalances(
  companyId: string,
  reconciliationId: string,
  input: {
    openingBalanceCents: number;
    closingBalanceCents: number;
    closingDate?: Date | null;
    notes?: string | null;
  },
) {
  const reconciliation = await db.bankReconciliation.findFirst({
    where: { id: reconciliationId, companyId },
  });
  if (!reconciliation) throw new Error("Reconciliation not found in this company.");
  if (reconciliation.status !== "IN_PROGRESS") throw new Error("This reconciliation is completed and locked.");

  const closingDate = input.closingDate ? toUtcDay(input.closingDate) : null;
  if (closingDate) assertDate(closingDate);

  await db.bankReconciliation.update({
    where: { id: reconciliationId },
    data: {
      openingBalanceCents: input.openingBalanceCents,
      closingBalanceCents: input.closingBalanceCents,
      statementClosingDate: closingDate,
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
  // The GL is read as of the reconciliation date; the statement up to its own closing date.
  const periodEnd = reconciliation.statementDate;
  const statementEnd = reconciliation.statementClosingDate ?? periodEnd;
  const glAccountId = reconciliation.bankAccount.accountId;
  const currency = reconciliation.bankAccount.currency;

  const [statementTxns, bookLines, consumed] = await Promise.all([
    client.bankTransaction.findMany({
      where: {
        companyId,
        bankAccountId: reconciliation.bankAccountId,
        date: { lte: statementEnd },
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

  // Statement movement is this period's activity only: credits (deposits) and
  // debits (withdrawals) from the bank's side.
  const periodTxns = statementTxns.filter((t) => t.date >= periodStart && t.date <= statementEnd);
  const statementCreditsCents = periodTxns.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
  const statementDebitsCents = periodTxns.filter((t) => t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0);
  const statementMovementCents = statementCreditsCents - statementDebitsCents;

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
  const bridge = reconciliationBridge({
    statementBalanceCents: reconciliation.closingBalanceCents,
    outstandingReceiptsCents: outstandingReceiptsFinal,
    outstandingPaymentsCents: outstandingPaymentsFinal,
    glBalanceCents: bookBalanceCents,
  });
  const adjustedBankBalanceCents = completed
    ? reconciliation.adjustedBankBalanceCents ?? bridge.adjustedBankBalanceCents
    : bridge.adjustedBankBalanceCents;
  const differenceCents = completed ? reconciliation.differenceCents : bridge.differenceCents;

  const statementBalanceValid =
    reconciliation.openingBalanceCents + statementMovementCents === reconciliation.closingBalanceCents;
  const allStatementMatched = statementRows.every((r) => r.matchId !== null);
  const canComplete =
    reconciliation.status === "IN_PROGRESS" && differenceCents === 0;

  const monthLabel = formatDate(periodEnd);
  const nextMonthLabel = "the next reconciliation";

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
    statementDateIso: isoDate(periodEnd),
    statementClosingDateIso: isoDate(statementEnd),
    openingBalanceCents: reconciliation.openingBalanceCents,
    closingBalanceCents: reconciliation.closingBalanceCents,
    bookBalanceCents,
    statementMovementCents,
    statementCreditsCents,
    statementDebitsCents,
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
    // The closing balance entered is the statement figure the bridge starts from. Whether the
    // imported lines add up to it is advisory only: a partly imported statement must not stop a
    // reconciliation whose difference is zero.
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
        summary: `Reconciled ${summary.bankAccountName} as of ${report.monthLabel} — difference $0.00`,
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
    orderBy: [{ statementDate: "desc" }, { bankAccount: { name: "asc" } }],
    take: 60,
  });
}
