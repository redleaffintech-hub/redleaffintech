import "server-only";

/**
 * Monthly bank reconciliation (§11, §12) — Firestore implementation.
 *
 * One reconciliation per bank account per calendar month. Behaviour matches
 * src/server/banking/reconcile.ts. Structural change for Firestore: the stored
 * balance snapshot (`persistSummary`) is refreshed AFTER a mutation commits, not
 * inside the same transaction — a Firestore transaction cannot re-read the data
 * it just wrote, and the snapshot is a cache that `buildWorkspace` recomputes
 * anyway.
 */

import { addMonths, endOfMonth, formatMonthLong, isoDate, startOfMonth } from "@/lib/dates";
import { recordAudit } from "@/server/db/audit-logs";
import { bankAccounts, reconciliationId as reconIdOf } from "@/server/db/banking";
import { getAccount } from "@/server/db/accounts";
import { runTransaction, sub, toTimestamp } from "@/server/db/firestore";

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

export interface ReconciliationWorkspace {
  summary: ReconciliationSummary;
  statementRows: WorkspaceRow[];
  bookRows: WorkspaceRow[];
  matches: { id: string; netCents: number; statementTxnIds: string[]; bookLineIds: string[] }[];
  report: MonthEndReport;
}

interface ReconRow {
  id: string;
  companyId: string;
  bankAccountId: string;
  statementYear: number;
  statementMonth: number;
  statementStartDate: Date;
  statementEndDate: Date;
  openingBalanceCents: number;
  closingBalanceCents: number;
  clearedBalanceCents: number;
  differenceCents: number;
  bookBalanceCents: number | null;
  outstandingReceiptsCents: number;
  outstandingPaymentsCents: number;
  adjustedBankBalanceCents: number | null;
  reportJson: string | null;
  notes: string | null;
  version: number;
  status: string;
  completedAt: Date | null;
  lockedAt: Date | null;
}

const reconCol = (companyId: string) => sub(companyId, "bankReconciliations");
const matchCol = (companyId: string) => sub(companyId, "bankReconciliationMatches");
const ts = (t: FirebaseFirestore.Timestamp | null | undefined) => t?.toDate?.() ?? null;

function decodeRecon(d: FirebaseFirestore.DocumentData, id: string): ReconRow {
  return {
    id,
    companyId: d.companyId,
    bankAccountId: d.bankAccountId,
    statementYear: d.statementYear,
    statementMonth: d.statementMonth,
    statementStartDate: ts(d.statementStartDate)!,
    statementEndDate: ts(d.statementEndDate)!,
    openingBalanceCents: d.openingBalanceCents ?? 0,
    closingBalanceCents: d.closingBalanceCents ?? 0,
    clearedBalanceCents: d.clearedBalanceCents ?? 0,
    differenceCents: d.differenceCents ?? 0,
    bookBalanceCents: d.bookBalanceCents ?? null,
    outstandingReceiptsCents: d.outstandingReceiptsCents ?? 0,
    outstandingPaymentsCents: d.outstandingPaymentsCents ?? 0,
    adjustedBankBalanceCents: d.adjustedBankBalanceCents ?? null,
    reportJson: d.reportJson ?? null,
    notes: d.notes ?? null,
    version: d.version ?? 0,
    status: d.status ?? "IN_PROGRESS",
    completedAt: ts(d.completedAt),
    lockedAt: ts(d.lockedAt),
  };
}

function assertMonth(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Invalid statement year.");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Invalid statement month.");
}

// ── Start / resume ─────────────────────────────────────────────────────────

export async function getOrStartReconciliation(
  companyId: string,
  input: { bankAccountId: string; year: number; month: number },
  userId?: string | null,
): Promise<ReconRow> {
  assertMonth(input.year, input.month);
  const bankAccount = await bankAccounts.get(companyId, input.bankAccountId);
  if (!bankAccount) throw new Error("Bank account not found in this company.");

  const id = reconIdOf(input.bankAccountId, input.year, input.month);
  const existing = await reconCol(companyId).doc(id).get();
  if (existing.exists) return decodeRecon(existing.data()!, existing.id);

  const periodStart = startOfMonth(new Date(Date.UTC(input.year, input.month - 1, 1)));
  const periodEnd = endOfMonth(periodStart);

  const priorCompleted = (
    await reconCol(companyId)
      .where("bankAccountId", "==", input.bankAccountId)
      .where("status", "==", "COMPLETED")
      .get()
  ).docs
    .map((d) => decodeRecon(d.data(), d.id))
    .sort((a, b) => b.statementEndDate.getTime() - a.statementEndDate.getTime())[0];

  const openingBalanceCents = priorCompleted
    ? priorCompleted.closingBalanceCents
    : bankAccount.openingBalanceCents;

  await reconCol(companyId)
    .doc(id)
    .set(
      {
        companyId,
        bankAccountId: input.bankAccountId,
        statementYear: input.year,
        statementMonth: input.month,
        statementStartDate: toTimestamp(periodStart),
        statementEndDate: toTimestamp(periodEnd),
        openingBalanceCents,
        closingBalanceCents: openingBalanceCents,
        clearedBalanceCents: 0,
        differenceCents: 0,
        bookBalanceCents: null,
        outstandingReceiptsCents: 0,
        outstandingPaymentsCents: 0,
        adjustedBankBalanceCents: null,
        reportJson: null,
        notes: null,
        version: 0,
        status: "IN_PROGRESS",
        startedById: userId ?? null,
        completedAt: null,
        completedById: null,
        lockedAt: null,
        createdAt: toTimestamp(new Date()),
      },
      { merge: true },
    );
  return decodeRecon((await reconCol(companyId).doc(id).get()).data()!, id);
}

export async function saveStatementBalances(
  companyId: string,
  reconciliationId: string,
  input: { openingBalanceCents: number; closingBalanceCents: number; notes?: string | null },
) {
  const snap = await reconCol(companyId).doc(reconciliationId).get();
  if (!snap.exists) throw new Error("Reconciliation not found in this company.");
  const recon = decodeRecon(snap.data()!, snap.id);
  if (recon.status !== "IN_PROGRESS") throw new Error("This reconciliation is completed and locked.");

  await reconCol(companyId).doc(reconciliationId).update({
    openingBalanceCents: input.openingBalanceCents,
    closingBalanceCents: input.closingBalanceCents,
    notes: input.notes ?? null,
  });
  return persistSummary(companyId, reconciliationId);
}

// ── Consumed match ids ─────────────────────────────────────────────────────

async function loadConsumed(companyId: string, bankAccountId: string) {
  const matches = await matchCol(companyId).where("bankAccountId", "==", bankAccountId).get();
  const reconStatus = new Map<string, string>();
  const anyTxn = new Set<string>();
  const anyLine = new Set<string>();
  const completedTxn = new Set<string>();
  const completedLine = new Set<string>();
  const rows = matches.docs.map((d) => d.data());
  const reconIds = [...new Set(rows.map((r) => r.reconciliationId as string))];
  await Promise.all(
    reconIds.map(async (rid) => {
      const s = await reconCol(companyId).doc(rid).get();
      reconStatus.set(rid, s.exists ? (s.data()!.status as string) : "IN_PROGRESS");
    }),
  );
  for (const m of rows) {
    const completed = reconStatus.get(m.reconciliationId) === "COMPLETED";
    for (const id of (m.statementTxnIds as string[]) ?? []) {
      anyTxn.add(id);
      if (completed) completedTxn.add(id);
    }
    for (const id of (m.bookLineIds as string[]) ?? []) {
      anyLine.add(id);
      if (completed) completedLine.add(id);
    }
  }
  return { anyTxn, anyLine, completedTxn, completedLine };
}

/** Posted, non-reversal bank-ledger lines for `accountId` dated on or before `asOf`. */
async function bankLedgerLines(companyId: string, accountId: string, asOf: Date) {
  const linesSnap = await sub(companyId, "journalLines")
    .where("accountId", "==", accountId)
    .where("date", "<=", toTimestamp(asOf))
    .get();
  const raw = linesSnap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      journalEntryId: x.journalEntryId as string,
      date: (x.date as FirebaseFirestore.Timestamp).toDate(),
      lineNo: (x.lineNo as number) ?? 0,
      debitCents: (x.debitCents as number) ?? 0,
      creditCents: (x.creditCents as number) ?? 0,
      description: (x.description as string | null) ?? null,
    };
  });
  const entryIds = [...new Set(raw.map((l) => l.journalEntryId))];
  const entries = new Map<string, { status: string; reversalOfId: string | null; entryNo: string; memo: string | null; sourceNumber: string | null }>();
  for (let i = 0; i < entryIds.length; i += 30) {
    const chunk = entryIds.slice(i, i + 30);
    const snap = await sub(companyId, "journalEntries")
      .where("__name__", "in", chunk.map((id) => sub(companyId, "journalEntries").doc(id)))
      .get();
    for (const d of snap.docs) {
      const e = d.data();
      entries.set(d.id, {
        status: e.status,
        reversalOfId: e.reversalOfId ?? null,
        entryNo: e.entryNo,
        memo: e.memo ?? null,
        sourceNumber: e.sourceNumber ?? null,
      });
    }
  }
  return raw
    .map((l) => ({ ...l, entry: entries.get(l.journalEntryId) }))
    .filter((l) => l.entry && l.entry.status === "POSTED" && !l.entry.reversalOfId)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.lineNo - b.lineNo);
}

// ── Matching ───────────────────────────────────────────────────────────────

export async function matchSelected(
  companyId: string,
  reconciliationId: string,
  statementTxnIds: string[],
  bookLineIds: string[],
  userId?: string | null,
) {
  await runTransaction(async (tx) => {
    const reconSnap = await tx.get(reconCol(companyId).doc(reconciliationId));
    if (!reconSnap.exists) throw new Error("Reconciliation not found in this company.");
    const recon = decodeRecon(reconSnap.data()!, reconSnap.id);
    if (recon.status !== "IN_PROGRESS") throw new Error("This reconciliation is completed and locked.");
    if (statementTxnIds.length === 0 || bookLineIds.length === 0) {
      throw new Error("Select at least one statement line and one book entry.");
    }
    const bankAccount = await bankAccounts.getTx(tx, companyId, recon.bankAccountId);
    if (!bankAccount) throw new Error("The reconciliation's bank account no longer exists.");

    const txnSnaps = await tx.getAll(
      ...statementTxnIds.map((id) => sub(companyId, "bankTransactions").doc(id)),
    );
    const txns = txnSnaps.filter((s) => s.exists).map((s) => s.data()!);
    if (
      txns.length !== statementTxnIds.length ||
      txns.some((t) => ["EXCLUDED", "RECONCILED"].includes(t.status) || t.bankAccountId !== recon.bankAccountId)
    ) {
      throw new Error("A selected statement line is missing, excluded or already reconciled.");
    }

    const lineSnaps = await tx.getAll(
      ...bookLineIds.map((id) => sub(companyId, "journalLines").doc(id)),
    );
    const lines = lineSnaps.filter((s) => s.exists).map((s) => s.data()!);
    if (lines.length !== bookLineIds.length || lines.some((l) => l.accountId !== bankAccount.accountId)) {
      throw new Error("A selected book entry is missing or does not post to this bank account.");
    }

    const stmtNet = txns.reduce((s, t) => s + (t.amountCents as number), 0);
    const bookNet = lines.reduce((s, l) => s + (l.debitCents as number) - (l.creditCents as number), 0);
    if (stmtNet === 0 || bookNet === 0) throw new Error("A match cannot net to zero.");
    if (stmtNet !== bookNet) {
      throw new Error(
        `Totals do not agree: statement ${(stmtNet / 100).toFixed(2)} vs books ${(bookNet / 100).toFixed(2)}.`,
      );
    }

    const { newId } = await import("@/server/db/firestore");
    const matchId = newId();
    tx.set(matchCol(companyId).doc(matchId), {
      companyId,
      reconciliationId,
      bankAccountId: recon.bankAccountId,
      netCents: stmtNet,
      statementTxnIds,
      bookLineIds,
      createdById: userId ?? null,
      createdAt: toTimestamp(new Date()),
    });
    for (const id of statementTxnIds) {
      tx.update(sub(companyId, "bankTransactions").doc(id), { reconciliationId });
    }
  });

  // Consumed-elsewhere validation and the snapshot refresh both need a full
  // read of the workspace, which cannot share the mutating transaction.
  return persistSummary(companyId, reconciliationId);
}

export async function removeMatch(companyId: string, reconciliationId: string, matchId: string) {
  await runTransaction(async (tx) => {
    const reconSnap = await tx.get(reconCol(companyId).doc(reconciliationId));
    if (!reconSnap.exists) throw new Error("Reconciliation not found in this company.");
    if (decodeRecon(reconSnap.data()!, reconSnap.id).status !== "IN_PROGRESS") {
      throw new Error("A completed reconciliation is locked — its matches cannot be removed.");
    }
    const matchSnap = await tx.get(matchCol(companyId).doc(matchId));
    if (!matchSnap.exists || matchSnap.data()!.reconciliationId !== reconciliationId) {
      throw new Error("Match not found in this reconciliation.");
    }
    const statementTxnIds = (matchSnap.data()!.statementTxnIds as string[]) ?? [];
    tx.delete(matchCol(companyId).doc(matchId));
    for (const id of statementTxnIds) {
      tx.update(sub(companyId, "bankTransactions").doc(id), { reconciliationId: null });
    }
  });
  return persistSummary(companyId, reconciliationId);
}

// ── Workspace + report ─────────────────────────────────────────────────────

export async function buildWorkspace(
  companyId: string,
  reconciliationId: string,
): Promise<ReconciliationWorkspace> {
  const reconSnap = await reconCol(companyId).doc(reconciliationId).get();
  if (!reconSnap.exists) throw new Error("Reconciliation not found in this company.");
  const recon = decodeRecon(reconSnap.data()!, reconSnap.id);

  const periodStart = recon.statementStartDate;
  const periodEnd = recon.statementEndDate;

  const bankAccount = await bankAccounts.get(companyId, recon.bankAccountId);
  if (!bankAccount) throw new Error("The reconciliation's bank account no longer exists.");
  const glAccount = await getAccount(companyId, bankAccount.accountId);
  const currency = bankAccount.currency;
  const glAccountId = bankAccount.accountId;

  const [stmtSnap, bookLines, consumed, matchSnap] = await Promise.all([
    sub(companyId, "bankTransactions")
      .where("bankAccountId", "==", recon.bankAccountId)
      .where("date", "<=", toTimestamp(periodEnd))
      .orderBy("date")
      .get(),
    bankLedgerLines(companyId, glAccountId, periodEnd),
    loadConsumed(companyId, recon.bankAccountId),
    matchCol(companyId).where("reconciliationId", "==", reconciliationId).get(),
  ]);

  const statementTxns = stmtSnap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        date: (x.date as FirebaseFirestore.Timestamp).toDate(),
        description: (x.description as string) ?? "",
        reference: (x.reference as string | null) ?? null,
        amountCents: (x.amountCents as number) ?? 0,
        status: (x.status as string) ?? "UNMATCHED",
      };
    })
    .filter((t) => t.status !== "EXCLUDED");

  const reconMatches = matchSnap.docs.map((d) => ({
    id: d.id,
    netCents: d.data().netCents as number,
    statementTxnIds: (d.data().statementTxnIds as string[]) ?? [],
    bookLineIds: (d.data().bookLineIds as string[]) ?? [],
  }));

  const matchOfTxn = new Map<string, string>();
  const matchOfLine = new Map<string, string>();
  for (const m of reconMatches) {
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
      description: l.description ?? l.entry!.memo ?? "Journal entry",
      sublabel: l.entry!.sourceNumber ?? l.entry!.entryNo,
      drCents: l.debitCents,
      crCents: l.creditCents,
      matchId: matchOfLine.get(l.id) ?? null,
      lockedElsewhere: consumed.completedLine.has(l.id),
      prior: l.date < periodStart,
    }));

  const statementMovementCents = statementTxns
    .filter((t) => t.date >= periodStart && t.date <= periodEnd)
    .reduce((s, t) => s + t.amountCents, 0);

  const liveBookBalance = bookLines.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
  const bookBalanceCents =
    recon.status === "COMPLETED" && recon.bookBalanceCents != null
      ? recon.bookBalanceCents
      : liveBookBalance;

  const outstandingBookRows = bookRows.filter((r) => r.matchId === null);
  const outstandingReceipts = outstandingBookRows
    .filter((r) => r.drCents > 0)
    .map((r) => ({ date: r.date, description: r.description, amountCents: r.drCents }));
  const outstandingPayments = outstandingBookRows
    .filter((r) => r.crCents > 0)
    .map((r) => ({ date: r.date, description: r.description, amountCents: r.crCents }));
  const outstandingReceiptsCents = outstandingReceipts.reduce((s, r) => s + r.amountCents, 0);
  const outstandingPaymentsCents = outstandingPayments.reduce((s, r) => s + r.amountCents, 0);

  const unmatchedStatementItems = statementRows
    .filter((r) => r.matchId === null)
    .map((r) => ({
      date: r.date,
      description: r.description,
      amountCents: r.crCents > 0 ? r.crCents : -r.drCents,
    }));

  const completed = recon.status === "COMPLETED";
  const outstandingReceiptsFinal = completed ? recon.outstandingReceiptsCents : outstandingReceiptsCents;
  const outstandingPaymentsFinal = completed ? recon.outstandingPaymentsCents : outstandingPaymentsCents;
  const adjustedBankBalanceCents = completed
    ? recon.adjustedBankBalanceCents ??
      recon.closingBalanceCents + outstandingReceiptsFinal - outstandingPaymentsFinal
    : recon.closingBalanceCents + outstandingReceiptsCents - outstandingPaymentsCents;
  const differenceCents = completed ? recon.differenceCents : adjustedBankBalanceCents - bookBalanceCents;

  const statementBalanceValid =
    recon.openingBalanceCents + statementMovementCents === recon.closingBalanceCents;
  const allStatementMatched = statementRows.every((r) => r.matchId !== null);
  const canComplete =
    recon.status === "IN_PROGRESS" && statementBalanceValid && allStatementMatched && differenceCents === 0;

  const monthLabel = formatMonthLong(periodStart);
  const nextMonthLabel = formatMonthLong(addMonths(periodStart, 1));

  const liveReport: MonthEndReport = {
    asOfIso: isoDate(periodEnd),
    currency,
    bankAccountName: bankAccount.name,
    monthLabel,
    nextMonthLabel,
    statementClosingCents: recon.closingBalanceCents,
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
    completed && recon.reportJson
      ? { ...(JSON.parse(recon.reportJson) as MonthEndReport), frozen: true }
      : liveReport;

  void glAccount;
  const summary: ReconciliationSummary = {
    id: recon.id,
    bankAccountId: recon.bankAccountId,
    bankAccountName: bankAccount.name,
    currency,
    year: recon.statementYear,
    month: recon.statementMonth,
    periodStartIso: isoDate(periodStart),
    periodEndIso: isoDate(periodEnd),
    monthLabel,
    openingBalanceCents: recon.openingBalanceCents,
    closingBalanceCents: recon.closingBalanceCents,
    bookBalanceCents,
    statementMovementCents,
    outstandingReceiptsCents: outstandingReceiptsFinal,
    outstandingPaymentsCents: outstandingPaymentsFinal,
    adjustedBankBalanceCents,
    differenceCents,
    status: recon.status,
    version: recon.version,
    lockedAt: recon.lockedAt ? recon.lockedAt.toISOString() : null,
    completedAt: recon.completedAt ? recon.completedAt.toISOString() : null,
    notes: recon.notes,
    statementBalanceValid,
    allStatementMatched,
    canComplete,
  };

  return { summary, statementRows, bookRows, matches: reconMatches, report };
}

async function persistSummary(companyId: string, reconciliationId: string) {
  const { summary } = await buildWorkspace(companyId, reconciliationId);
  await reconCol(companyId).doc(reconciliationId).update({
    clearedBalanceCents: summary.adjustedBankBalanceCents,
    differenceCents: summary.differenceCents,
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
  const workspace = await buildWorkspace(companyId, reconciliationId);
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
      `Adjusted difference is ${(summary.differenceCents / 100).toFixed(2)}, not zero. Unexplained bank-only items must be posted as adjustments through the ledger.`,
    );
  }

  const statementTxnIds = workspace.matches.flatMap((m) => m.statementTxnIds);

  await runTransaction(async (tx) => {
    const snap = await tx.get(reconCol(companyId).doc(reconciliationId));
    if (!snap.exists) throw new Error("Reconciliation not found in this company.");
    const recon = decodeRecon(snap.data()!, snap.id);
    if (recon.status !== "IN_PROGRESS" || recon.version !== expectedVersion) {
      throw new Error("This reconciliation was changed by someone else. Reload and try again.");
    }
    tx.update(reconCol(companyId).doc(reconciliationId), {
      status: "COMPLETED",
      version: recon.version + 1,
      completedAt: toTimestamp(new Date()),
      completedById: userId,
      lockedAt: toTimestamp(new Date()),
      clearedBalanceCents: summary.adjustedBankBalanceCents,
      differenceCents: 0,
      bookBalanceCents: summary.bookBalanceCents,
      outstandingReceiptsCents: summary.outstandingReceiptsCents,
      outstandingPaymentsCents: summary.outstandingPaymentsCents,
      adjustedBankBalanceCents: summary.adjustedBankBalanceCents,
      reportJson: JSON.stringify({ ...report, frozen: true }),
    });
    for (const id of statementTxnIds) {
      tx.update(sub(companyId, "bankTransactions").doc(id), {
        status: "RECONCILED",
        reconciliationId,
      });
    }
  });

  await recordAudit({
    companyId,
    userId,
    action: "UPDATE",
    entityType: "BankReconciliation",
    entityId: reconciliationId,
    summary: `Reconciled ${summary.bankAccountName} for ${report.monthLabel} — difference $0.00`,
  });

  return decodeRecon((await reconCol(companyId).doc(reconciliationId).get()).data()!, reconciliationId);
}

// ── History ────────────────────────────────────────────────────────────────

export async function reconciliationHistory(companyId: string, bankAccountId?: string) {
  let q: FirebaseFirestore.Query = reconCol(companyId);
  if (bankAccountId) q = q.where("bankAccountId", "==", bankAccountId);
  const rows = (await q.get()).docs.map((d) => decodeRecon(d.data(), d.id));
  return rows
    .sort((a, b) => b.statementEndDate.getTime() - a.statementEndDate.getTime())
    .slice(0, 60);
}
