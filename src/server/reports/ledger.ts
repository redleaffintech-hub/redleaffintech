import "server-only";

/**
 * The shared read primitive behind every financial report (§12) — Firestore.
 *
 * Prisma reports call `journalLine.groupBy(accountId) + _sum` with a date
 * filter. Firestore has neither, so a period balance is assembled from:
 *
 *   1. the `accountPeriodBalances` roll-up for every whole month strictly
 *      before the cutoff month  (one indexed query), plus
 *   2. a `journalLines` line-scan for the cutoff's own partial month.
 *
 * A range [from, to] is `sumsUpTo(to, inclusive) − sumsUpTo(from, exclusive)`.
 * When `cutoff` is a month-end the partial scan just covers the whole month, so
 * the result is identical either way.
 */

import { startOfMonth } from "@/lib/dates";
import { sub, toTimestamp } from "@/server/db/firestore";

export interface AccountSum {
  debitCents: number;
  creditCents: number;
  accountType: string;
}

const monthKey = (d: Date) => d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);

/**
 * Per-account debit/credit totals for every line dated on or before `cutoff`
 * (`inclusive: false` makes it strictly before). Keyed by accountId.
 */
export async function sumsUpTo(
  companyId: string,
  cutoff: Date,
  opts: { inclusive?: boolean } = {},
): Promise<Map<string, AccountSum>> {
  const inclusive = opts.inclusive ?? true;
  const out = new Map<string, AccountSum>();
  const add = (accountId: string, accountType: string, d: number, c: number) => {
    const cur = out.get(accountId) ?? { debitCents: 0, creditCents: 0, accountType };
    cur.debitCents += d;
    cur.creditCents += c;
    cur.accountType = accountType || cur.accountType;
    out.set(accountId, cur);
  };

  // 1. Roll-up for whole months before the cutoff month.
  const cutoffMonthKey = monthKey(cutoff);
  const rollup = await sub(companyId, "accountPeriodBalances")
    .where("periodKey", "<", cutoffMonthKey)
    .get();
  for (const doc of rollup.docs) {
    const r = doc.data();
    add(r.accountId, r.accountType, r.debitCents ?? 0, r.creditCents ?? 0);
  }

  // 2. Line-scan for the cutoff's own month.
  const monthStart = startOfMonth(cutoff);
  let q = sub(companyId, "journalLines").where("date", ">=", toTimestamp(monthStart));
  q = inclusive
    ? q.where("date", "<=", toTimestamp(cutoff))
    : q.where("date", "<", toTimestamp(cutoff));
  const lines = await q.get();
  for (const doc of lines.docs) {
    const l = doc.data();
    add(l.accountId, l.accountType, l.debitCents ?? 0, l.creditCents ?? 0);
  }

  return out;
}

/**
 * Per-account totals for lines dated within [from, to] inclusive.
 */
export async function sumsInRange(
  companyId: string,
  from: Date,
  to: Date,
): Promise<Map<string, AccountSum>> {
  const [upToTo, beforeFrom] = await Promise.all([
    sumsUpTo(companyId, to, { inclusive: true }),
    sumsUpTo(companyId, from, { inclusive: false }),
  ]);
  const out = new Map<string, AccountSum>();
  const keys = new Set([...upToTo.keys(), ...beforeFrom.keys()]);
  for (const id of keys) {
    const a = upToTo.get(id);
    const b = beforeFrom.get(id);
    out.set(id, {
      debitCents: (a?.debitCents ?? 0) - (b?.debitCents ?? 0),
      creditCents: (a?.creditCents ?? 0) - (b?.creditCents ?? 0),
      accountType: a?.accountType ?? b?.accountType ?? "",
    });
  }
  return out;
}

/** Signed balance of one account as of a date, in its natural direction is the
 * caller's job — this returns raw `debit − credit`. */
export async function accountRawBalanceAsOf(
  companyId: string,
  accountId: string,
  asOf: Date,
): Promise<number> {
  const cutoffMonthKey = monthKey(asOf);
  const [rollup, lines] = await Promise.all([
    sub(companyId, "accountPeriodBalances")
      .where("accountId", "==", accountId)
      .where("periodKey", "<", cutoffMonthKey)
      .get(),
    sub(companyId, "journalLines")
      .where("accountId", "==", accountId)
      .where("date", ">=", toTimestamp(startOfMonth(asOf)))
      .where("date", "<=", toTimestamp(asOf))
      .get(),
  ]);
  let bal = 0;
  for (const d of rollup.docs) bal += (d.data().debitCents ?? 0) - (d.data().creditCents ?? 0);
  for (const d of lines.docs) bal += (d.data().debitCents ?? 0) - (d.data().creditCents ?? 0);
  return bal;
}
