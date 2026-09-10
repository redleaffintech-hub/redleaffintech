import "server-only";

/**
 * The double-entry posting engine (§5) — Firestore implementation.
 *
 * Firestore transactions require every read to precede every write, so posting
 * is split into two phases that a caller can interleave with its own reads and
 * writes:
 *
 *   planPosting(tx, input)   -> PostingPlan   (reads only)
 *   commitPosting(tx, plan)  -> entry+lines   (writes only)
 *
 * `postJournal` runs both back to back — the shape the simple callers (manual
 * journal, opening balances, year-end close) want. Document flows that also read
 * customers / tax codes / stock call planPosting during their own read phase and
 * commitPosting during their write phase.
 *
 * Behaviour and invariants mirror src/server/accounting/ledger.ts exactly.
 */

import type { AccountType } from "@/lib/enums";
import { NORMAL_BALANCE } from "@/lib/enums";
import { SEQUENCE_FIELD } from "@/server/db/companies";
import { getAccountsTx, getSystemAccountTx } from "@/server/db/accounts";
import { allBalances, applyLineToBalanceTx } from "@/server/db/account-balances";
import { recordAuditTx } from "@/server/db/audit-logs";
import { companyRef, type Tx } from "@/server/db/firestore";
import { findPeriodForDateTx } from "@/server/db/fiscal-periods";
import {
  createEntryTx,
  getEntryWithLinesTx,
  updateEntryTx,
  type LineDraft,
} from "@/server/db/journal-entries";
import type { Account, JournalEntryWithLines } from "@/server/db/types";

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

/** Resolve a control account by its stable handle. Read — call during planning. */
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
    throw new PostingError(`${period.name} is locked and cannot accept any posting.`, "PERIOD_CLOSED");
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
  return normalized;
}

export interface PostingPlan {
  input: PostJournalInput;
  normalized: NormalizedLine[];
  accountTypeById: Map<string, string>;
  fiscalPeriodId: string;
  periodName: string;
  entryNo: string;
  /** company.nextJournalNumber at read time; commit writes back +1 (unless overridden). */
  counterAt: number | null;
  totalDebit: number;
  totalCredit: number;
}

/** READ PHASE. */
export async function planPosting(tx: Tx, input: PostJournalInput): Promise<PostingPlan> {
  const { companyId, date } = input;
  const normalized = normalizeLines(input.lines);

  const companySnap = await tx.get(companyRef(companyId));
  const owner = companySnap.data();
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
  const accountTypeById = new Map<string, string>();
  for (const id of accountIds) {
    const account = byId.get(id);
    if (!account) throw new PostingError(`Account ${id} does not exist in this company.`, "UNKNOWN_ACCOUNT");
    if (!account.isActive) {
      throw new PostingError(`Account ${account.code} ${account.name} is archived.`, "UNKNOWN_ACCOUNT");
    }
    accountTypeById.set(id, account.type);
  }

  const period = await resolveOpenPeriod(tx, companyId, date, input.allowClosedPeriod);

  let entryNo: string;
  let counterAt: number | null = null;
  if (input.entryNoOverride) {
    entryNo = input.entryNoOverride;
  } else {
    const spec = SEQUENCE_FIELD.journal;
    counterAt = Number(owner?.[spec.next] ?? 1);
    entryNo = `${String(owner?.[spec.prefix] ?? "")}${String(counterAt).padStart(spec.pad, "0")}`;
  }

  return {
    input,
    normalized,
    accountTypeById,
    fiscalPeriodId: period.id,
    periodName: period.name,
    entryNo,
    counterAt,
    totalDebit: normalized.reduce((s, l) => s + l.debitCents, 0),
    totalCredit: normalized.reduce((s, l) => s + l.creditCents, 0),
  };
}

/** WRITE PHASE. */
export function commitPosting(tx: Tx, plan: PostingPlan): JournalEntryWithLines {
  const { input, normalized } = plan;
  const { companyId, date } = input;

  if (plan.counterAt !== null) {
    const spec = SEQUENCE_FIELD.journal;
    tx.update(companyRef(companyId), { [spec.next]: plan.counterAt + 1 });
  }

  const lineDrafts: LineDraft[] = normalized.map((line, index) => ({
    lineNo: index + 1,
    accountId: line.accountId,
    accountType: plan.accountTypeById.get(line.accountId)!,
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
      entryNo: plan.entryNo,
      date,
      memo: input.memo ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceNumber: input.sourceNumber ?? null,
      isAdjusting: input.isAdjusting ?? false,
      fiscalPeriodId: plan.fiscalPeriodId,
      totalDebitCents: plan.totalDebit,
      totalCreditCents: plan.totalCredit,
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
    summary: `Posted ${plan.entryNo} — ${input.sourceType}${input.sourceNumber ? ` ${input.sourceNumber}` : ""} for ${(plan.totalDebit / 100).toFixed(2)}`,
    metadata: { totalDebit: plan.totalDebit, totalCredit: plan.totalCredit, period: plan.periodName },
  });

  return entry;
}

/** Plan + commit back to back. For callers with no reads of their own. */
export async function postJournal(
  tx: Tx,
  input: PostJournalInput,
): Promise<JournalEntryWithLines> {
  return commitPosting(tx, await planPosting(tx, input));
}

/**
 * Reverse a posted entry with a mirror-image entry (§5.1). Reads the original in
 * this call, so it must be the caller's first tx operation on that data.
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

  const plan = await planPosting(tx, {
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
  const reversal = commitPosting(tx, plan);

  updateEntryTx(tx, opts.companyId, reversal.id, { reversalOfId: original.id });
  updateEntryTx(tx, opts.companyId, original.id, { status: "REVERSED" });

  return reversal;
}

export function naturalBalance(
  type: AccountType,
  debitCents: number,
  creditCents: number,
): number {
  return NORMAL_BALANCE[type] === "DEBIT" ? debitCents - creditCents : creditCents - debitCents;
}

export async function checkLedgerIntegrity(companyId: string) {
  const balances = await allBalances(companyId);
  let debits = 0;
  let credits = 0;
  const byType: Partial<Record<AccountType, number>> = {};
  for (const b of balances) {
    debits += b.debitCents;
    credits += b.creditCents;
    const t = b.accountType as AccountType;
    byType[t] = (byType[t] ?? 0) + naturalBalance(t, b.debitCents, b.creditCents);
  }
  const assets = byType.ASSET ?? 0;
  const liabilities = byType.LIABILITY ?? 0;
  const equity = byType.EQUITY ?? 0;
  const netIncome = (byType.REVENUE ?? 0) - (byType.EXPENSE ?? 0);
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
