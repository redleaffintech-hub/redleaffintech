/**
 * The double-entry posting engine (spec §5).
 *
 * Every financial event in Red Leaf Accounting — invoice, bill, expense, payment,
 * credit note, bank categorisation, manual journal, year-end close — funnels
 * through `postJournal`. Nothing else may write to journal_entries.
 *
 * Invariants enforced here, not by callers:
 *   1. Total debits == total credits, exactly, in integer cents.
 *   2. Every account referenced exists, is active, and belongs to the company.
 *   3. The date falls inside an OPEN fiscal period (§14).
 *   4. Posted entries are immutable — corrections go through `reverseJournal`.
 *   5. Every entry retains source type, source id, user, timestamp and period.
 */

import type { Tx } from "@/lib/db";
import type { AccountType } from "@/lib/enums";
import { NORMAL_BALANCE } from "@/lib/enums";

export class PostingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "UNBALANCED"
      | "NO_LINES"
      | "BAD_LINE"
      | "UNKNOWN_ACCOUNT"
      | "PERIOD_CLOSED"
      | "NO_PERIOD"
      | "IMMUTABLE"
      | "READ_ONLY"
      | "ALREADY_REVERSED",
  ) {
    super(message);
    this.name = "PostingError";
  }
}

export interface JournalLineInput {
  accountId: string;
  /** Exactly one of debitCents / creditCents may be non-zero. */
  debitCents?: number;
  creditCents?: number;
  description?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
  projectId?: string | null;
  taxCodeId?: string | null;
}

export interface PostJournalInput {
  companyId: string;
  date: Date;
  memo?: string | null;
  sourceType: string;
  sourceId?: string | null;
  sourceNumber?: string | null;
  lines: JournalLineInput[];
  isAdjusting?: boolean;
  createdById?: string | null;
  /** Only the accountant adjusting-entry path may set this, after a permission check. */
  allowClosedPeriod?: boolean;
  entryNoOverride?: string;
}

/** Resolve a control account by its stable handle (AR, AP, GST payable...). */
export async function getSystemAccount(tx: Tx, companyId: string, systemKey: string) {
  const account = await tx.account.findFirst({ where: { companyId, systemKey } });
  if (!account) {
    throw new PostingError(
      `Company is missing the required system account "${systemKey}". Complete chart-of-accounts setup first.`,
      "UNKNOWN_ACCOUNT",
    );
  }
  return account;
}

/**
 * The fiscal period containing `date`. Throws if the period is missing or not
 * open — this is the gate that makes "closed periods reject postings" true for
 * every source document at once, rather than per-screen.
 */
export async function resolveOpenPeriod(
  tx: Tx,
  companyId: string,
  date: Date,
  allowClosed = false,
) {
  const period = await tx.fiscalPeriod.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
  });
  if (!period) {
    throw new PostingError(
      `No fiscal period covers ${date.toISOString().slice(0, 10)}. Create the fiscal year before posting.`,
      "NO_PERIOD",
    );
  }
  if (period.status !== "OPEN" && !allowClosed) {
    throw new PostingError(
      `${period.name} is ${period.status.toLowerCase()}. Reopen the period or post to an open date.`,
      "PERIOD_CLOSED",
    );
  }
  if (period.status === "LOCKED") {
    throw new PostingError(`${period.name} is locked and cannot accept any posting.`, "PERIOD_CLOSED");
  }
  return period;
}

async function nextEntryNo(tx: Tx, companyId: string): Promise<string> {
  const company = await tx.company.update({
    where: { id: companyId },
    data: { nextJournalNumber: { increment: 1 } },
    select: { journalPrefix: true, nextJournalNumber: true },
  });
  // update returns the value AFTER increment, so the number we consumed is -1
  return `${company.journalPrefix}${String(company.nextJournalNumber - 1).padStart(5, "0")}`;
}

/**
 * Post a balanced journal entry. MUST be called inside a db transaction so a
 * partial posting can never survive (§5.1).
 */
export async function postJournal(tx: Tx, input: PostJournalInput) {
  const { companyId, date, lines } = input;

  // A read-only company file accepts no new postings. This is the chokepoint
  // every financial mutation passes through — invoices, bills, expenses,
  // payments, journals and reversals all end up here — so enforcing it once is
  // what makes a suspended, cancelled or lapsed subscription actually mean
  // something. Reading, reporting and exporting are untouched: the books stay
  // the customer's, whatever the state of their account.
  const owner = await tx.company.findUnique({
    where: { id: companyId },
    select: { isReadOnly: true, archivedAt: true },
  });
  if (owner?.isReadOnly) {
    throw new PostingError(
      "This company file is read-only. Its books remain readable and exportable, but no new entries can be posted.",
      "READ_ONLY",
    );
  }
  // Archived is a separate state from the platform's isReadOnly, checked
  // independently: restoring an archived company must never depend on, or
  // interfere with, a suspension the platform applied for its own reasons.
  if (owner?.archivedAt) {
    throw new PostingError(
      "This company is archived. Restore it from Company → Companies before posting.",
      "READ_ONLY",
    );
  }

  if (!lines || lines.length < 2) {
    throw new PostingError("A journal entry needs at least two lines.", "NO_LINES");
  }

  // ── Normalise and validate each line ─────────────────────────────────────
  const normalized = lines.map((line, index) => {
    const debit = Math.trunc(line.debitCents ?? 0);
    const credit = Math.trunc(line.creditCents ?? 0);
    if (debit < 0 || credit < 0) {
      throw new PostingError(
        `Line ${index + 1}: debits and credits must be positive. Flip the side instead of using a negative amount.`,
        "BAD_LINE",
      );
    }
    if (debit > 0 && credit > 0) {
      throw new PostingError(`Line ${index + 1}: a line cannot be both a debit and a credit.`, "BAD_LINE");
    }
    if (debit === 0 && credit === 0) {
      throw new PostingError(`Line ${index + 1}: amount is zero.`, "BAD_LINE");
    }
    return { ...line, debitCents: debit, creditCents: credit };
  });

  const totalDebit = normalized.reduce((s, l) => s + l.debitCents, 0);
  const totalCredit = normalized.reduce((s, l) => s + l.creditCents, 0);
  if (totalDebit !== totalCredit) {
    const diff = (totalDebit - totalCredit) / 100;
    throw new PostingError(
      `Entry is out of balance by $${Math.abs(diff).toFixed(2)}. Debits $${(totalDebit / 100).toFixed(2)} vs credits $${(totalCredit / 100).toFixed(2)}.`,
      "UNBALANCED",
    );
  }

  // ── Tenant isolation: every account must belong to THIS company ──────────
  const accountIds = [...new Set(normalized.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({
    where: { id: { in: accountIds }, companyId },
    select: { id: true, type: true, isActive: true, name: true, code: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const id of accountIds) {
    const account = byId.get(id);
    if (!account) {
      throw new PostingError(`Account ${id} does not exist in this company.`, "UNKNOWN_ACCOUNT");
    }
    if (!account.isActive) {
      throw new PostingError(`Account ${account.code} ${account.name} is archived.`, "UNKNOWN_ACCOUNT");
    }
  }

  const period = await resolveOpenPeriod(tx, companyId, date, input.allowClosedPeriod);
  const entryNo = input.entryNoOverride ?? (await nextEntryNo(tx, companyId));

  const entry = await tx.journalEntry.create({
    data: {
      companyId,
      entryNo,
      date,
      memo: input.memo ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceNumber: input.sourceNumber ?? null,
      status: "POSTED",
      isAdjusting: input.isAdjusting ?? false,
      fiscalPeriodId: period.id,
      totalDebitCents: totalDebit,
      totalCreditCents: totalCredit,
      createdById: input.createdById ?? null,
      postedAt: new Date(),
      lines: {
        create: normalized.map((line, index) => ({
          companyId,
          date,
          lineNo: index + 1,
          accountId: line.accountId,
          accountType: byId.get(line.accountId)!.type,
          description: line.description ?? null,
          debitCents: line.debitCents,
          creditCents: line.creditCents,
          customerId: line.customerId ?? null,
          vendorId: line.vendorId ?? null,
          projectId: line.projectId ?? null,
          taxCodeId: line.taxCodeId ?? null,
        })),
      },
    },
    include: { lines: true },
  });

  await tx.auditLog.create({
    data: {
      companyId,
      userId: input.createdById ?? null,
      action: "POST",
      entityType: "JournalEntry",
      entityId: entry.id,
      summary: `Posted ${entryNo} — ${input.sourceType}${input.sourceNumber ? ` ${input.sourceNumber}` : ""} for ${(totalDebit / 100).toFixed(2)}`,
      metadata: JSON.stringify({ totalDebit, totalCredit, period: period.name }),
    },
  });

  return entry;
}

/**
 * Reverse a posted entry with a mirror-image entry (§5.1 — corrections never
 * mutate history). The reversal keeps the source linkage so drill-down and the
 * audit trail stay intact.
 */
export async function reverseJournal(
  tx: Tx,
  entryId: string,
  opts: { companyId: string; date?: Date; memo?: string; userId?: string | null; allowClosedPeriod?: boolean },
) {
  const original = await tx.journalEntry.findFirst({
    where: { id: entryId, companyId: opts.companyId },
    include: { lines: true, reversedBy: true },
  });
  if (!original) throw new PostingError("Journal entry not found in this company.", "UNKNOWN_ACCOUNT");
  if (original.status === "REVERSED" || original.reversedBy) {
    throw new PostingError(`${original.entryNo} has already been reversed.`, "ALREADY_REVERSED");
  }

  const reversal = await postJournal(tx, {
    companyId: opts.companyId,
    date: opts.date ?? original.date,
    memo: opts.memo ?? `Reversal of ${original.entryNo}${original.memo ? ` — ${original.memo}` : ""}`,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    sourceNumber: original.sourceNumber,
    createdById: opts.userId ?? null,
    allowClosedPeriod: opts.allowClosedPeriod,
    lines: original.lines.map((line) => ({
      accountId: line.accountId,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
      description: line.description,
      customerId: line.customerId,
      vendorId: line.vendorId,
      projectId: line.projectId,
      taxCodeId: line.taxCodeId,
    })),
  });

  await tx.journalEntry.update({
    where: { id: reversal.id },
    data: { reversalOfId: original.id },
  });
  await tx.journalEntry.update({
    where: { id: original.id },
    data: { status: "REVERSED" },
  });

  return reversal;
}

/** Signed balance in the account's natural direction. */
export function naturalBalance(type: AccountType, debitCents: number, creditCents: number): number {
  return NORMAL_BALANCE[type] === "DEBIT" ? debitCents - creditCents : creditCents - debitCents;
}

/**
 * Ledger integrity probe (§5.3). Returns the out-of-balance amount across the
 * whole company; anything other than 0 is an exception the UI must surface.
 */
export async function checkLedgerIntegrity(tx: Tx, companyId: string) {
  const totals = await tx.journalLine.aggregate({
    where: { companyId },
    _sum: { debitCents: true, creditCents: true },
  });
  const debits = totals._sum.debitCents ?? 0;
  const credits = totals._sum.creditCents ?? 0;

  const grouped = await tx.journalLine.groupBy({
    by: ["accountType"],
    where: { companyId },
    _sum: { debitCents: true, creditCents: true },
  });
  const byType = Object.fromEntries(
    grouped.map((g) => [
      g.accountType,
      naturalBalance(g.accountType as AccountType, g._sum.debitCents ?? 0, g._sum.creditCents ?? 0),
    ]),
  ) as Record<AccountType, number>;

  const assets = byType.ASSET ?? 0;
  const liabilities = byType.LIABILITY ?? 0;
  const equity = byType.EQUITY ?? 0;
  const revenue = byType.REVENUE ?? 0;
  const expense = byType.EXPENSE ?? 0;
  const netIncome = revenue - expense;

  return {
    debits,
    credits,
    outOfBalanceCents: debits - credits,
    balanced: debits === credits,
    assets,
    liabilities,
    equity,
    netIncome,
    /** Assets − (Liabilities + Equity + Net income). Must be 0. */
    equationGapCents: assets - (liabilities + equity + netIncome),
  };
}
