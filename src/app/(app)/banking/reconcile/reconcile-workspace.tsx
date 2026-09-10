"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Badge, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { ReconciliationWorkspace, WorkspaceRow, MonthEndReport } from "@/server/banking/reconcile-fs";
import {
  completeReconciliationAction,
  matchSelectedAction,
  openReconciliationAction,
  removeMatchAction,
  saveStatementBalancesAction,
} from "../actions";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface HistoryRow {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  year: number;
  month: number;
  monthLabel: string;
  status: string;
  closingBalanceCents: number;
  differenceCents: number;
  completedAtIso: string | null;
}

export function ReconcileClient({
  currency,
  canWrite,
  bankAccounts,
  accountId,
  year,
  month,
  monthLabel,
  carryOpeningCents,
  workspace,
  history,
}: {
  currency: string;
  canWrite: boolean;
  bankAccounts: { id: string; name: string }[];
  accountId: string;
  year: number;
  month: number;
  monthLabel: string;
  carryOpeningCents: number;
  workspace: ReconciliationWorkspace | null;
  history: HistoryRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cardMoney = (cents: number) =>
    `${currency} ${formatMoney(cents, { showCurrency: false, accountingNegative: true })}`;

  function go(nextAccount: string, nextYear: number, nextMonth: number) {
    router.push(`/banking/reconcile?account=${nextAccount}&year=${nextYear}&month=${nextMonth}`);
  }

  const monthOptions = useMemo(() => {
    const out: { year: number; month: number; label: string }[] = [];
    // A fixed window around the selected month, so the current choice is always present.
    for (let offset = 3; offset >= -24; offset--) {
      const base = new Date(Date.UTC(year, month - 1 + offset, 1));
      out.push({
        year: base.getUTCFullYear(),
        month: base.getUTCMonth() + 1,
        label: `${MONTH_NAMES[base.getUTCMonth()]} ${base.getUTCFullYear()}`,
      });
    }
    return out;
  }, [year, month]);

  const status = workspace?.summary.status ?? "NOT_STARTED";

  return (
    <div className="recon space-y-4">
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="rc-no-print flex flex-wrap items-end gap-3">
        <Field label="Bank account" className="w-56">
          <select
            value={accountId}
            onChange={(e) => go(e.target.value, year, month)}
            className={clsx(inputClass, "pr-8")}
          >
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Month" className="w-52">
          <select
            value={`${year}-${month}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              go(accountId, y, m);
            }}
            className={clsx(inputClass, "pr-8")}
          >
            {monthOptions.map((o) => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>{o.label}</option>
            ))}
          </select>
        </Field>

        <span className="pb-1.5">
          {status === "COMPLETED" ? (
            <Badge tone="positive">Completed</Badge>
          ) : status === "IN_PROGRESS" ? (
            <Badge tone="caution">In progress</Badge>
          ) : (
            <Badge tone="neutral">Not started</Badge>
          )}
        </span>

        <div className="flex-1" />

        <Link
          href="/banking"
          className="inline-flex items-center rounded-md border border-brand-600 px-3 py-1.5 text-[0.8125rem] font-medium text-brand-700 hover:bg-brand-50"
        >
          Import statement
        </Link>
        {workspace && workspace.summary.status === "IN_PROGRESS" && canWrite && (
          <SaveProgress
            currency={currency}
            reconciliationId={workspace.summary.id}
            openingBalanceCents={workspace.summary.openingBalanceCents}
            closingBalanceCents={workspace.summary.closingBalanceCents}
            notes={workspace.summary.notes ?? ""}
          />
        )}
      </div>

      {error && (
        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      {!workspace ? (
        <NotStarted
          monthLabel={monthLabel}
          currency={currency}
          carryOpeningCents={carryOpeningCents}
          canWrite={canWrite}
          onBegin={() => {
            setError(null);
            startTransition(async () => {
              const result = await openReconciliationAction(accountId, year, month);
              if ("error" in result && result.error) setError(result.error);
              else router.refresh();
            });
          }}
          pending={pending}
        />
      ) : (
        <Workspace
          workspace={workspace}
          currency={currency}
          cardMoney={cardMoney}
          canWrite={canWrite}
          onError={setError}
        />
      )}

      {history.length > 0 && (
        <Card className="rc-no-print p-5">
          <CardHeader title="Reconciliation history" subtitle="Completed months are locked; their reports never change." />
          <div className="rc-scroll mt-3">
            <table className="rc-table min-w-[36rem]">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Month</th>
                  <th className="rc-num">Closing balance</th>
                  <th className="rc-num">Difference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <button
                        type="button"
                        onClick={() => go(h.bankAccountId, h.year, h.month)}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {h.bankAccountName}
                      </button>
                    </td>
                    <td className="text-[color:var(--color-muted-ink)]">{h.monthLabel}</td>
                    <td className="rc-num">{cardMoney(h.closingBalanceCents)}</td>
                    <td className="rc-num">{cardMoney(h.differenceCents)}</td>
                    <td>
                      {h.status === "COMPLETED" ? (
                        <Badge tone="positive">completed</Badge>
                      ) : (
                        <Badge tone="caution">in progress</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Not started ─────────────────────────────────────────────────────────────

function NotStarted({
  monthLabel,
  currency,
  carryOpeningCents,
  canWrite,
  onBegin,
  pending,
}: {
  monthLabel: string;
  currency: string;
  carryOpeningCents: number;
  canWrite: boolean;
  onBegin: () => void;
  pending: boolean;
}) {
  return (
    <Card className="p-6 text-center">
      <p className="text-[0.9375rem] font-semibold text-ink-900">No reconciliation for {monthLabel} yet</p>
      <p className="mx-auto mt-1 max-w-md text-[0.8125rem] leading-6 text-muted-ink">
        The statement period runs the first through the last day of {monthLabel}. The opening balance carries
        forward from the last completed reconciliation:{" "}
        <span className="font-medium text-ink-800">
          {currency} {formatMoney(carryOpeningCents, { showCurrency: false })}
        </span>
        .
      </p>
      <Button
        variant="primary"
        className="mx-auto mt-4"
        disabled={!canWrite || pending}
        onClick={onBegin}
      >
        {pending ? "Starting…" : `Begin ${monthLabel} reconciliation`}
      </Button>
    </Card>
  );
}

// ── Save progress (statement figures) ───────────────────────────────────────

function SaveProgress({
  currency,
  reconciliationId,
  openingBalanceCents,
  closingBalanceCents,
  notes,
}: {
  currency: string;
  reconciliationId: string;
  openingBalanceCents: number;
  closingBalanceCents: number;
  notes: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState((openingBalanceCents / 100).toFixed(2));
  const [closing, setClosing] = useState((closingBalanceCents / 100).toFixed(2));
  const [note, setNote] = useState(notes);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveStatementBalancesAction(reconciliationId, opening, closing, note);
      if ("error" in result && result.error) setError(result.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen((v) => !v)}>Save progress</Button>
      {open && (
        <div className="w-full rounded-lg border border-paper-300 bg-white p-4">
          <p className="text-[0.8125rem] font-semibold text-ink-900">Statement figures</p>
          <p className="mt-0.5 text-[0.75rem] leading-5 text-muted-ink">
            Take both balances straight from the {currency} bank statement. Opening carries forward from the last
            completed month.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Statement opening balance">
              <input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" className={clsx(inputClass, "tnum")} />
            </Field>
            <Field label="Statement closing balance">
              <input value={closing} onChange={(e) => setClosing(e.target.value)} inputMode="decimal" className={clsx(inputClass, "tnum")} />
            </Field>
          </div>
          <Field label="Notes on outstanding items" className="mt-3">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputClass} />
          </Field>
          {error && <p className="mt-2 text-[0.8125rem] text-negative">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Workspace ───────────────────────────────────────────────────────────────

function Workspace({
  workspace,
  currency,
  cardMoney,
  canWrite,
  onError,
}: {
  workspace: ReconciliationWorkspace;
  currency: string;
  cardMoney: (cents: number) => string;
  canWrite: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const { summary, statementRows, bookRows, report } = workspace;
  const [pending, startTransition] = useTransition();
  const [selStatement, setSelStatement] = useState<Set<string>>(new Set());
  const [selBook, setSelBook] = useState<Set<string>>(new Set());
  const inProgress = summary.status === "IN_PROGRESS";
  const editable = inProgress && canWrite;

  const stmtNet = statementRows
    .filter((r) => selStatement.has(r.key))
    .reduce((s, r) => s + r.crCents - r.drCents, 0);
  const bookNet = bookRows
    .filter((r) => selBook.has(r.key))
    .reduce((s, r) => s + r.drCents - r.crCents, 0);
  const selectionValid =
    selStatement.size > 0 && selBook.size > 0 && stmtNet !== 0 && stmtNet === bookNet;

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    onError(null);
    startTransition(async () => {
      const result = await fn();
      if (result?.error) onError(result.error);
      else {
        setSelStatement(new Set());
        setSelBook(new Set());
        router.refresh();
      }
    });
  }

  return (
    <>
      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Statement closing balance" value={cardMoney(summary.closingBalanceCents)} />
        <StatCard label="Book balance" value={cardMoney(summary.bookBalanceCents)} />
        <StatCard
          label="Adjusted difference"
          value={cardMoney(summary.differenceCents)}
          accent={summary.differenceCents !== 0}
        />
      </div>

      {/* Panels */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="As per Bank Statement"
          subtitle={`${formatDate(summary.periodStartIso)} – ${formatDate(summary.periodEndIso)} · Bank perspective`}
          rows={statementRows}
          selected={selStatement}
          onToggle={editable ? (key) => toggle(selStatement, key, setSelStatement) : undefined}
          matchBadgeLabel="Matched"
        />
        <Panel
          title="As per Books"
          subtitle="Bank account ledger · Company perspective"
          rows={bookRows}
          selected={selBook}
          onToggle={editable ? (key) => toggle(selBook, key, setSelBook) : undefined}
          matchBadgeLabel="Matched"
          outstandingLabel="Outstanding"
        />
      </div>

      <p className="mt-2 flex items-center gap-2 text-[0.75rem] text-muted-ink">
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-paper-400 text-[0.625rem] font-bold text-ink-700">i</span>
        Deposits appear as credits on the bank statement and debits in the bank ledger.
      </p>

      {/* Match bar */}
      {editable && (
        <div className="rc-no-print mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-paper-300 bg-white px-4 py-3">
          <span className="text-[0.8125rem] text-ink-800">
            <span className="font-medium">{selStatement.size}</span> statement ·{" "}
            <span className="font-medium">{selBook.size}</span> book selected
          </span>
          <span className="text-[0.75rem] text-muted-ink">
            statement net {formatMoney(stmtNet, { showCurrency: false, accountingNegative: true })} · book net{" "}
            {formatMoney(bookNet, { showCurrency: false, accountingNegative: true })}
          </span>
          <div className="flex-1" />
          {!selectionValid && (selStatement.size > 0 || selBook.size > 0) && (
            <span className="text-[0.75rem] text-caution">
              {stmtNet === 0
                ? "Select entries that net to a non-zero amount."
                : "Statement and book totals must be equal and the same cash direction."}
            </span>
          )}
          <Button
            variant="primary"
            disabled={!selectionValid || pending}
            onClick={() =>
              run(() =>
                matchSelectedAction(summary.id, [...selStatement], [...selBook]),
              )
            }
          >
            Match selected
          </Button>
        </div>
      )}

      {/* Existing matches — removable only while in progress */}
      {workspace.matches.length > 0 && editable && (
        <div className="rc-no-print mt-3 rounded-lg border border-paper-300 bg-white p-4">
          <p className="text-[0.8125rem] font-semibold text-ink-900">Matches this month</p>
          <ul className="mt-2 divide-y divide-paper-200">
            {workspace.matches.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2 text-[0.8125rem]">
                <span className="flex-1 text-ink-700">
                  {m.statementTxnIds.length} statement ↔ {m.bookLineIds.length} book ·{" "}
                  {formatMoney(m.netCents, { showCurrency: false, accountingNegative: true })}
                </span>
                <button
                  type="button"
                  className="text-[0.75rem] font-medium text-maple-600 hover:underline"
                  disabled={pending}
                  onClick={() => run(() => removeMatchAction(summary.id, m.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Month-end report */}
      <MonthEndReportCard
        report={report}
        summary={summary}
        currency={currency}
        cardMoney={cardMoney}
        canComplete={summary.canComplete && canWrite}
        pending={pending}
        onComplete={() =>
          run(() => completeReconciliationAction(summary.id, summary.version))
        }
      />
    </>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-ink">{label}</p>
      <p className={clsx("tnum mt-1 text-[1.375rem] font-semibold tracking-[-0.02em]", accent ? "text-maple-600" : "text-ink-950")}>
        {value}
      </p>
    </Card>
  );
}

function Panel({
  title,
  subtitle,
  rows,
  selected,
  onToggle,
  matchBadgeLabel,
  outstandingLabel,
}: {
  title: string;
  subtitle: string;
  rows: WorkspaceRow[];
  selected: Set<string>;
  onToggle?: (key: string) => void;
  matchBadgeLabel: string;
  outstandingLabel?: string;
}) {
  return (
    <Card className="p-5">
      <h2 className="text-[1.0625rem] font-semibold text-ink-900">{title}</h2>
      <p className="mt-0.5 text-[0.8125rem] text-muted-ink">{subtitle}</p>
      <div className="rc-scroll mt-3">
        <table className="rc-table min-w-[30rem]">
          <thead>
            <tr>
              <th className="w-9" />
              <th className="w-24">Date</th>
              <th>Description</th>
              <th className="rc-num w-24">Dr</th>
              <th className="rc-num w-24">Cr</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted-ink">Nothing in this panel for the period.</td>
              </tr>
            )}
            {rows.map((row) => {
              const isSel = selected.has(row.key);
              const checkable = Boolean(onToggle) && !row.matchId && !row.lockedElsewhere;
              return (
                <tr key={row.key} className={clsx(isSel && "rc-selected")}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isSel}
                      disabled={!checkable}
                      onChange={() => onToggle?.(row.key)}
                      aria-label={`Select ${row.description}`}
                      className="h-4 w-4 accent-[color:var(--color-brand-600)] disabled:opacity-40"
                    />
                  </td>
                  <td className="whitespace-nowrap">{formatDate(row.date)}</td>
                  <td>
                    <span>{row.description}</span>
                    {row.sublabel && (
                      <span className="block text-[0.6875rem] text-muted-ink">{row.sublabel}</span>
                    )}
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {row.matchId && <Badge tone="positive">{matchBadgeLabel}</Badge>}
                      {!row.matchId && !row.lockedElsewhere && row.prior && outstandingLabel && (
                        <Badge tone="caution">{outstandingLabel}</Badge>
                      )}
                      {row.lockedElsewhere && <Badge tone="neutral">reconciled earlier</Badge>}
                    </span>
                  </td>
                  <td className="rc-num">{row.drCents > 0 ? formatMoney(row.drCents, { showCurrency: false }) : "—"}</td>
                  <td className="rc-num">{row.crCents > 0 ? formatMoney(row.crCents, { showCurrency: false }) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Month-end report ────────────────────────────────────────────────────────

function MonthEndReportCard({
  report,
  summary,
  currency,
  cardMoney,
  canComplete,
  pending,
  onComplete,
}: {
  report: MonthEndReport;
  summary: ReconciliationWorkspace["summary"];
  currency: string;
  cardMoney: (cents: number) => string;
  canComplete: boolean;
  pending: boolean;
  onComplete: () => void;
}) {
  const plain = (c: number) => formatMoney(c, { showCurrency: false, accountingNegative: true });
  return (
    <Card className="rc-report mt-4 p-6">
      <h2 className="text-[1.25rem] font-semibold text-ink-900">
        Bank Reconciliation as of {formatDate(report.asOfIso)}
      </h2>
      {report.frozen && (
        <p className="mt-1 text-[0.75rem] text-muted-ink">
          Locked {summary.completedAt ? formatDate(summary.completedAt.slice(0, 10)) : ""} — this report is frozen and will not change.
        </p>
      )}

      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <div>
          <ReportTable title="Outstanding receipts / deposits in transit" currency={currency} rows={report.outstandingReceipts} empty="None — every book receipt has cleared." />
          <div className="mt-5">
            <ReportTable title="Outstanding payments" currency={currency} rows={report.outstandingPayments} empty="None — every book payment has cleared." />
          </div>

          {report.unmatchedStatementItems.length > 0 && (
            <div className="mt-5 rounded-lg border border-[color:var(--color-caution)]/30 bg-caution-soft p-3">
              <p className="text-[0.8125rem] font-semibold text-ink-900">
                Unmatched statement items — investigate or adjust
              </p>
              <p className="mt-0.5 text-[0.75rem] leading-5 text-ink-700">
                Bank movements with no entry in the books. These are not timing differences: record a journal
                adjustment through Accounting → Journal entries, then match it here.
              </p>
              <ul className="mt-2 space-y-1 text-[0.75rem] text-ink-800">
                {report.unmatchedStatementItems.map((r, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span>{formatDate(r.date)} · {r.description}</span>
                    <span className="tnum">{plain(r.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-[0.75rem] text-muted-ink">
            Uncleared items carry forward to {report.nextMonthLabel} and are matched there. This report will not be
            rewritten when they clear.
          </p>
        </div>

        <div className="text-[0.875rem]">
          <ReconLine label="Bank statement balance" value={plain(report.statementClosingCents)} />
          <ReconLine label="Add: outstanding receipts" value={plain(report.outstandingReceiptsCents)} />
          <ReconLine label="Less: outstanding payments" value={plain(report.outstandingPaymentsCents)} />
          <div className="my-2 border-t border-[#a9bdc9]" />
          <ReconLine label="Adjusted bank balance" value={cardMoney(report.adjustedBankBalanceCents)} bold />
          <ReconLine label="Book balance" value={cardMoney(report.bookBalanceCents)} />
          <div className="my-2 border-t border-[#a9bdc9]" />
          <ReconLine
            label="Difference"
            value={formatMoney(report.differenceCents, { showCurrency: false, accountingNegative: true })}
            bold
            accent={report.differenceCents !== 0}
          />

          <div className="mt-3">
            {report.balanced ? (
              <Badge tone="positive">Balanced</Badge>
            ) : (
              <Badge tone="caution">Out of balance</Badge>
            )}
          </div>

          {summary.status === "IN_PROGRESS" && (
            <>
              {!summary.statementBalanceValid && (
                <p className="mt-3 text-[0.75rem] text-caution">
                  Statement opening + statement movement ≠ closing balance. Import the whole statement or fix the figures.
                </p>
              )}
              {summary.statementBalanceValid && !summary.allStatementMatched && (
                <p className="mt-3 text-[0.75rem] text-caution">
                  Every statement transaction must be matched before completing.
                </p>
              )}
              <div className="rc-no-print mt-4 flex justify-end">
                <Button variant="primary" disabled={!canComplete || pending} onClick={onComplete}>
                  {pending ? "Completing…" : `Complete ${summary.monthLabel} reconciliation`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function ReportTable({
  title,
  currency,
  rows,
  empty,
}: {
  title: string;
  currency: string;
  rows: { date: string; description: string; amountCents: number }[];
  empty: string;
}) {
  return (
    <div>
      <p className="text-[0.9375rem] font-semibold text-ink-900">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-[0.8125rem] text-muted-ink">{empty}</p>
      ) : (
        <div className="rc-scroll mt-2">
          <table className="rc-table min-w-[24rem]">
            <thead>
              <tr>
                <th className="w-24">Date</th>
                <th>Description</th>
                <th className="rc-num w-32">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                  <td>{r.description}</td>
                  <td className="rc-num">{currency} {formatMoney(r.amountCents, { showCurrency: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReconLine({
  label,
  value,
  bold,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-6 py-1", bold && "font-semibold")}>
      <span className={clsx(bold ? "text-ink-900" : "text-muted-ink")}>{label}</span>
      <span className={clsx("tnum", accent ? "text-maple-600" : bold ? "text-ink-950" : "text-ink-800")}>{value}</span>
    </div>
  );
}
