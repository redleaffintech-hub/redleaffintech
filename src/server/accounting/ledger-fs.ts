import "server-only";

/**
 * The double-entry posting engine (§5) — Firestore implementation.
 *
 * Mirrors src/server/accounting/ledger.ts exactly in behaviour and invariants.
 * The only structural change is the datastore: `postJournal` and `reverseJournal`
 * run inside a Firestore `runTransaction` callback and additionally maintain the
 * `accountPeriodBalances` roll-up (§4).
 *
 * FIRESTORE TRANSACTION RULE: every read (tx.get) must precede every write. The
 * ordering inside `postJournal` is deliberate — company, accounts and period are
 * read first; `bumpSequenceTx` does the last read then the first write; entry,
 * lines, roll-ups and audit are writes only.
 */

import type { AccountType } from "@/lib/enums";
import { NORMAL_BALANCE } from "@/lib/enums";
import { getAccountsTx, getSystemAccountTx } from "@/server/db/accounts";
import { allBalances, applyLineToBalanceTx } from "@/server/db/account-balances";
import { recordAuditTx } from "@/server/db/audit-logs";
import { bumpSequenceTx, getCompanyTx } from "@/server/db/companies";
import { findPeriodForDateTx } from "@/server/db/fiscal-periods";
import {
  createEntryTx,
  getEntryWithLinesTx,
  updateEntryTx,
  type LineDraft,
} from "@/server/db/journal-entries";
import type { Account, JournalEntryWithLines } from "@/server/db/types";
import type { Tx } from "@/server/db/firestore";

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
  allowClosedPeriod?: boolean;
  entryNoOverride?: string;
}

/** Resolve a control account by its stable handle (AR, AP, GST payable…). */
export async function getSystemAccount(
  tx: Tx,
  companyId: string,
  systemKey: string,
): Promise<Account> {
  const account = await getSystemAccountTx(tx, companyId, systemKey);
  if (!account) {
    throw new PostingError(
      `Company is missing the required system account "${systemKey}". Complete chart-of-accounts setup first.`,
      "UNKNOWN_ACCOUNT",
    );
  }
  return account;
}

/** The fiscal period containing `date`; throws if missing or not open. */
export async function resolveOpenPeriod(
  tx: Tx,
  companyId: string,
  date: Date,
  allowClosed = false,
) {
  const period = await findPeriodForDateTx(tx, companyId, date);
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
    throw new PostingError(
      `${period.name} is locked and cannot accept any posting.`,
      "PERIOD_CLOSED",
    );
  }
  return period;
}

interface NormalizedLine extends JournalLineInput {
  debitCents: number;
  creditCents: number;
}

function normalizeLines(lines: JournalLineInput[]): NormalizedLine[] {
  if (!lines || lines.length < 2) {
    throw new PostingError("A journal entry needs at least two lines.", "NO_LINES");
  }
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
      throw new PostingError(
        `Line ${index + 1}: a line cannot be both a debit and a credit.`,
        "BAD_LINE",
      );
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
  return normalized;
}

/**
 * Post a balanced journal entry. MUST be called inside `runTransaction` so a
 * partial posting can never survive (§5.1).
 */
export async function postJournal(
  tx: Tx,
  input: PostJournalInput,
): Promise<JournalEntryWithLines> {
  const { companyId, date } = input;
  const normalized = normalizeLines(input.lines);

  // ── Reads ───────────────────────────────────────────────────────────────
  const owner = await getCompanyTx(tx, companyId);
  if (owner?.isReadOnly) {
    throw new PostingError(
      "This company file is read-only. Its books remain readable and exportable, but no new entries can be posted.",
      "READ_ONLY",
    );
  }
  if (owner?.archivedAt) {
    throw new PostingError(
      "This company is archived. Restore it from Company → Companies before posting.",
      "READ_ONLY",
    );
  }

  const accountIds = [...new Set(normalized.map((l) => l.accountId))];
  const byId = await getAccountsTx(tx, companyId, accountIds);
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

  // Last read + first write.
  const entryNo =
    input.entryNoOverride ?? (await bumpSequenceTx(tx, companyId, "journal"));

  // ── Writes ──────────────────────────────────────────────────────────────
  const totalDebit = normalized.reduce((s, l) => s + l.debitCents, 0);
  const totalCredit = normalized.reduce((s, l) => s + l.creditCents, 0);

  const lineDrafts: LineDraft[] = normalized.map((line, index) => ({
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
  }));

  const entry = createEntryTx(
    tx,
    {
      companyId,
      entryNo,
      date,
      memo: input.memo ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceNumber: input.sourceNumber ?? null,
      isAdjusting: input.isAdjusting ?? false,
      fiscalPeriodId: period.id,
      totalDebitCents: totalDebit,
      totalCreditCents: totalCredit,
      createdById: input.createdById ?? null,
    },
    lineDrafts,
  );

  for (const line of entry.lines) {
    applyLineToBalanceTx(tx, companyId, {
      accountId: line.accountId,
      accountType: line.accountType,
      date,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
    });
  }

  recordAuditTx(tx, {
    companyId,
    userId: input.createdById ?? null,
    action: "POST",
    entityType: "JournalEntry",
    entityId: entry.id,
    summary: `Posted ${entryNo} — ${input.sourceType}${input.sourceNumber ? ` ${input.sourceNumber}` : ""} for ${(totalDebit / 100).toFixed(2)}`,
    metadata: { totalDebit, totalCredit, period: period.name },
  });

  return entry;
}

/**
 * Reverse a posted entry with a mirror-image entry (§5.1). The reversal keeps
 * the source linkage so drill-down and the audit trail stay intact.
 */
export async function reverseJournal(
  tx: Tx,
  entryId: string,
  opts: {
    companyId: string;
    date?: Date;
    memo?: string;
    userId?: string | null;
    allowClosedPeriod?: boolean;
  },
): Promise<JournalEntryWithLines> {
  const original = await getEntryWithLinesTx(tx, opts.companyId, entryId);
  if (!original) {
    throw new PostingError("Journal entry not found in this company.", "UNKNOWN_ACCOUNT");
  }
  if (original.status === "REVERSED" || original.reversalOfId) {
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

  updateEntryTx(tx, opts.companyId, reversal.id, { reversalOfId: original.id });
  updateEntryTx(tx, opts.companyId, original.id, { status: "REVERSED" });

  return reversal;
}

/** Signed balance in the account's natural direction. */
export function naturalBalance(
  type: AccountType,
  debitCents: number,
  creditCents: number,
): number {
  return NORMAL_BALANCE[type] === "DEBIT"
    ? debitCents - creditCents
    : creditCents - debitCents;
}

/**
 * Ledger integrity probe (§5.3), from the `accountPeriodBalances` roll-up rather
 * than a scan of every line. Read-only, so no transaction.
 */
export async function checkLedgerIntegrity(companyId: string) {
  const balances = await allBalances(companyId);

  let debits = 0;
  let credits = 0;
  const byType: Partial<Record<AccountType, number>> = {};
  for (const b of balances) {
    debits += b.debitCents;
    credits += b.creditCents;
    const t = b.accountType as AccountType;
    byType[t] =
      (byType[t] ?? 0) + naturalBalance(t, b.debitCents, b.creditCents);
  }

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
    equationGapCents: assets - (liabilities + equity + netIncome),
  };
}
