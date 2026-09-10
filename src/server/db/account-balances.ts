import "server-only";

import type { DocumentData } from "firebase-admin/firestore";
import { FieldValue, mapDocs, sub, type Tx } from "./firestore";
import type { AccountPeriodBalance } from "./types";

/**
 * `companies/{companyId}/accountPeriodBalances/{accountId}_{YYYYMM}` (§4).
 *
 * The reporting roll-up. Firestore has no GROUP BY / cross-doc SUM, so instead
 * of scanning `journalLines` for a trial balance / balance sheet / P&L, every
 * posting transaction increments one of these docs per line, and reports read a
 * bounded month range of them.
 *
 * Reversals and voids post opposite lines, so the increments self-correct.
 */

const yyyymm = (date: Date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

export const balanceDocId = (accountId: string, date: Date) =>
  `${accountId}_${yyyymm(date)}`;

const col = (companyId: string) => sub(companyId, "accountPeriodBalances");

function decode(raw: DocumentData, id: string): AccountPeriodBalance {
  return {
    id,
    accountId: raw.accountId,
    accountType: raw.accountType,
    year: raw.year,
    month: raw.month,
    debitCents: raw.debitCents ?? 0,
    creditCents: raw.creditCents ?? 0,
  };
}

/**
 * Apply one journal line's debit/credit to its account-month roll-up. Call
 * inside the same transaction that writes the line. `increment` is a write and
 * needs no prior read, so it is safe after other reads in the callback.
 */
export function applyLineToBalanceTx(
  tx: Tx,
  companyId: string,
  line: { accountId: string; accountType: string; date: Date; debitCents: number; creditCents: number },
): void {
  const ref = col(companyId).doc(balanceDocId(line.accountId, line.date));
  const year = line.date.getUTCFullYear();
  const month = line.date.getUTCMonth() + 1;
  tx.set(
    ref,
    {
      accountId: line.accountId,
      accountType: line.accountType,
      year,
      month,
      periodKey: year * 100 + month,
      debitCents: FieldValue.increment(line.debitCents),
      creditCents: FieldValue.increment(line.creditCents),
    },
    { merge: true },
  );
}

/** Same, outside a transaction (bulk paths — year-end close fallback). */
export function balanceIncrementWrite(
  companyId: string,
  line: { accountId: string; accountType: string; date: Date; debitCents: number; creditCents: number },
) {
  const year = line.date.getUTCFullYear();
  const month = line.date.getUTCMonth() + 1;
  return {
    ref: col(companyId).doc(balanceDocId(line.accountId, line.date)),
    data: {
      accountId: line.accountId,
      accountType: line.accountType,
      year,
      month,
      periodKey: year * 100 + month,
      debitCents: FieldValue.increment(line.debitCents),
      creditCents: FieldValue.increment(line.creditCents),
    },
  };
}

// ── Reads for reports ────────────────────────────────────────────────────────

/** Every roll-up doc for the company (ledger-integrity probe, full trial balance). */
export async function allBalances(companyId: string): Promise<AccountPeriodBalance[]> {
  const snap = await col(companyId).get();
  return mapDocs(snap, decode);
}

/**
 * Roll-up docs within an inclusive month range [fromYYYYMM, toYYYYMM]. The doc id
 * sorts lexically the same as chronologically for a fixed accountId, but ids mix
 * account and month, so filter on the numeric `year`*100+`month` is clearer:
 * stored as separate fields, queried with a compound key we materialise here.
 */
export async function balancesInRange(
  companyId: string,
  from: Date,
  to: Date,
): Promise<AccountPeriodBalance[]> {
  const fromKey = from.getUTCFullYear() * 100 + (from.getUTCMonth() + 1);
  const toKey = to.getUTCFullYear() * 100 + (to.getUTCMonth() + 1);
  // `periodKey` is written alongside year/month for exactly this query.
  const snap = await col(companyId)
    .where("periodKey", ">=", fromKey)
    .where("periodKey", "<=", toKey)
    .get();
  return mapDocs(snap, decode);
}

/** All roll-up docs for one account, oldest first (account ledger opening balance). */
export async function balancesForAccount(
  companyId: string,
  accountId: string,
): Promise<AccountPeriodBalance[]> {
  const snap = await col(companyId).where("accountId", "==", accountId).get();
  return mapDocs(snap, decode).sort(
    (a, b) => a.year * 100 + a.month - (b.year * 100 + b.month),
  );
}
