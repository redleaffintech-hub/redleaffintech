"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Badge, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { DateField } from "@/components/date-field";
import { formatMoney } from "@/lib/money";
import { formatDate, addDays, toUtcDay, isoDate } from "@/lib/dates";
import { reconciliationBridge } from "@/lib/reconcile-summary";
import type { ReconciliationWorkspace, WorkspaceRow, MonthEndReport } from "@/server/banking/reconcile";
import { ImportPanel } from "../banking-tools";
import {
  completeReconciliationAction,
  matchSelectedAction,
  openReconciliationAction,
  removeMatchAction,
  saveStatementBalancesAction,
} from "../actions";

interface HistoryRow {
  id: string;
  bankAccountId: string;
  bankAccountName: string;
  dateIso: string;
  status: string;
  closingBalanceCents: number;
  differenceCents: number;
}

export function ReconcileClient({
  currency,
  canWrite,
  bankAccounts,
  accountId,
  dateIso,
  carryOpeningCents,
  lastCompletedIso,
  queueCount,
  workspace,
  history,
}: {
  currency: string;
  canWrite: boolean;
  bankAccounts: { id: string; name: string; type: string; accountNumberMasked: string | null }[];
  accountId: string;
  dateIso: string;
  /** Closing balance of the last completed reconciliation; null for the account's first. */
  carryOpeningCents: number | null;
  lastCompletedIso: string | null;
  queueCount: number;
  workspace: ReconciliationWorkspace | null;
  history: HistoryRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const cardMoney = (cents: number) =>
    `${currency} ${formatMoney(cents, { showCurrency: false, accountingNegative: true })}`;

  function go(nextAccount: string, nextDate: string) {
    router.push(`/banking/reconcile?account=${nextAccount}&date=${nextDate}`);
  }

  const status = workspace?.summary.status ?? "NOT_STARTED";
  const minDate = lastCompletedIso ? isoDate(addDays(toUtcDay(lastCompletedIso), 1)) : undefined;

  return (
    <div className="recon space-y-4">
      {/* ── Steps 1–2: bank and reconciliation date ───────────────────────── */}
      <Card className="rc-no-print p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="1. Bank account" className="w-64">
            <select
              value={accountId}
              onChange={(e) => go(e.target.value, dateIso)}
              className={clsx(inputClass, "pr-8")}
            >
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="2. Reconciliation date" className="w-48">
            <DateField
              value={dateIso}
              allowEmpty={false}
              min={workspace ? undefined : minDate}
              onCommit={(value) => go(accountId, value)}
              aria-label="Reconciliation date"
            />
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

          <Link href="/banking" className="pb-1.5 text-[0.8125rem] font-medium text-brand-700 hover:underline">
            Review queue{queueCount > 0 ? ` (${queueCount})` : ""}
          </Link>
        </div>
        {lastCompletedIso && (
          <p className="mt-2 text-[0.75rem] text-muted-ink">
            Last reconciled up to {formatDate(lastCompletedIso)}. A new reconciliation must be dated after that.
          </p>
        )}
      </Card>

      {error && (
        <p className="rounded-md border border-[color:var(--color-negative)]/25 bg-negative-soft px-3 py-2 text-[0.8125rem] text-negative">
          {error}
        </p>
      )}

      {/* ── Steps 3–4: opening balance, closing balance and date ──────────── */}
      <StatementFigures
        key={`${accountId}-${dateIso}-${workspace?.summary.version ?? "new"}-${workspace?.summary.openingBalanceCents ?? ""}-${workspace?.summary.closingBalanceCents ?? ""}`}
        accountId={accountId}
        dateIso={dateIso}
        currency={currency}
        canWrite={canWrite}
        carryOpeningCents={carryOpeningCents}
        lastCompletedIso={lastCompletedIso}
        workspace={workspace}
        onError={setError}
      />

      {workspace && (
        <>
          {/* ── Step 5: import ────────────────────────────────────────────── */}
          {workspace.summary.status === "IN_PROGRESS" && canWrite && (
            <div className="rc-no-print">
              <ImportPanel bankAccounts={bankAccounts} lockedAccountId={accountId} />
            </div>
          )}

          {/* ── Steps 6–8: tables, matching, summary ──────────────────────── */}
          <Workspace
            key={workspace.summary.id}
            workspace={workspace}
            currency={currency}
            cardMoney={cardMoney}
            canWrite={canWrite}
            onError={setError}
          />
        </>
      )}

      {history.length > 0 && (
        <Card className="rc-no-print p-5">
          <CardHeader title="Reconciliation history" subtitle="Completed reconciliations are locked; their reports never change." />
          <div className="rc-scroll mt-3">
            <table className="rc-table min-w-[36rem]">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Date</th>
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
                        onClick={() => go(h.bankAccountId, h.dateIso)}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {h.bankAccountName}
                      </button>
                    </td>
                    <td className="text-[color:var(--color-muted-ink)]">{formatDate(h.dateIso)}</td>
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

// ── Statement figures (steps 3 and 4) ───────────────────────────────────────

const money2 = (cents: number) => (cents / 100).toFixed(2);

function StatementFigures({
  accountId,
  dateIso,
  currency,
  canWrite,
  carryOpeningCents,
  lastCompletedIso,
  workspace,
  onError,
}: {
  accountId: string;
  dateIso: string;
  currency: string;
  canWrite: boolean;
  carryOpeningCents: number | null;
  lastCompletedIso: string | null;
  workspace: ReconciliationWorkspace | null;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const summary = workspace?.summary ?? null;
  const locked = summary ? summary.status !== "IN_PROGRESS" : false;
  const editable = canWrite && !locked;

  // First reconciliation: blank, the user types it. Later ones: carried forward, still editable.
  const initialOpening = summary
    ? money2(summary.openingBalanceCents)
    : carryOpeningCents !== null
      ? money2(carryOpeningCents)
      : "";
  const [opening, setOpening] = useState(initialOpening);
  const [closing, setClosing] = useState(summary ? money2(summary.closingBalanceCents) : "");
  const [closingDate, setClosingDate] = useState(summary?.statementClosingDateIso ?? dateIso);
  const [notes, setNotes] = useState(summary?.notes ?? "");

  const changedFromCarry =
    carryOpeningCents !== null && opening.trim() !== "" && Math.round(Number(opening) * 100) !== carryOpeningCents;

  function save() {
    onError(null);
    startTransition(async () => {
      const result = summary
        ? await saveStatementBalancesAction(summary.id, opening, closing, closingDate, notes)
        : await openReconciliationAction(accountId, dateIso, opening, closing, closingDate);
      if ("error" in result && result.error) onError(result.error);
      else router.refresh();
    });
  }

  return (
    <Card className="rc-no-print p-5">
      <CardHeader
        title="Statement figures"
        subtitle={
          summary
            ? "Taken from the bank statement. Save after changing a figure."
            : "Enter the opening balance and the closing balance and date shown on the bank statement."
        }
      />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field
          label="3. Opening balance"
          required
          hint={
            carryOpeningCents === null
              ? "First reconciliation for this account — enter the opening balance from the statement."
              : changedFromCarry
                ? `Carried forward was ${currency} ${formatMoney(carryOpeningCents, { showCurrency: false })} (${lastCompletedIso ? formatDate(lastCompletedIso) : "last reconciliation"}); you have changed it.`
                : `Carried forward from the reconciliation on ${lastCompletedIso ? formatDate(lastCompletedIso) : "the last one"}. You can edit it.`
          }
        >
          <input
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            disabled={!editable}
            inputMode="decimal"
            placeholder="0.00"
            className={clsx(inputClass, "tnum")}
          />
        </Field>
        <Field label="4. Closing balance per statement" required>
          <input
            value={closing}
            onChange={(e) => setClosing(e.target.value)}
            disabled={!editable}
            inputMode="decimal"
            placeholder="0.00"
            className={clsx(inputClass, "tnum")}
          />
        </Field>
        <Field label="Statement closing date" required>
          <DateField
            value={closingDate}
            allowEmpty={false}
            onCommit={setClosingDate}
            aria-label="Statement closing date"
          />
        </Field>
      </div>
      {summary && (
        <Field label="Notes on outstanding items" className="mt-3">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} rows={2} className={inputClass} />
        </Field>
      )}
      {editable && (
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={pending || opening.trim() === ""}>
            {pending ? "Saving…" : summary ? "Save figures" : "Start reconciliation"}
          </Button>
          {!summary && opening.trim() === "" && (
            <span className="text-[0.75rem] text-muted-ink">Enter the opening balance to continue.</span>
          )}
        </div>
      )}
    </Card>
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

  // The five summary lines are derived from the rows as they stand, so they move
  // the moment a match is made or removed; a completed one reads its frozen figures.
  const bridge = useMemo(() => {
    if (!inProgress) {
      return reconciliationBridge({
        statementBalanceCents: report.statementClosingCents,
        outstandingReceiptsCents: report.outstandingReceiptsCents,
        outstandingPaymentsCents: report.outstandingPaymentsCents,
        glBalanceCents: report.bookBalanceCents,
      });
    }
    const open = bookRows.filter((r) => r.matchId === null);
    return reconciliationBridge({
      statementBalanceCents: summary.closingBalanceCents,
      outstandingReceiptsCents: open.reduce((s, r) => s + r.drCents, 0),
      outstandingPaymentsCents: open.reduce((s, r) => s + r.crCents, 0),
      glBalanceCents: summary.bookBalanceCents,
    });
  }, [inProgress, bookRows, report, summary.closingBalanceCents, summary.bookBalanceCents]);

  const unmatchedStatement = statementRows.filter((r) => r.matchId === null).length;

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
      {/* Step 6: statement left, GL right */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Transactions per bank statement"
          subtitle={`Up to ${formatDate(summary.statementClosingDateIso)} · Bank perspective`}
          rows={statementRows}
          selected={selStatement}
          onToggle={editable ? (key) => toggle(selStatement, key, setSelStatement) : undefined}
          matchBadgeLabel="Matched"
        />
        <Panel
          title="Transactions per GL"
          subtitle={`Bank account ledger up to ${formatDate(summary.statementDateIso)} · Company perspective`}
          rows={bookRows}
          selected={selBook}
          onToggle={editable ? (key) => toggle(selBook, key, setSelBook) : undefined}
          matchBadgeLabel="Matched"
          outstandingLabel="Outstanding"
        />
      </div>

      <p className="flex items-center gap-2 text-[0.75rem] text-muted-ink">
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full bg-paper-400 text-[0.625rem] font-bold text-ink-700">i</span>
        Deposits appear as credits on the bank statement and debits in the bank ledger.
      </p>

      {/* Step 7: match bar */}
      {editable && (
        <div className="rc-no-print flex flex-wrap items-center gap-3 rounded-lg border border-paper-300 bg-white px-4 py-3">
          <span className="text-[0.8125rem] text-ink-800">
            <span className="font-medium">{selStatement.size}</span> statement ·{" "}
            <span className="font-medium">{selBook.size}</span> GL selected
          </span>
          <span className="text-[0.75rem] text-muted-ink">
            statement net {formatMoney(stmtNet, { showCurrency: false, accountingNegative: true })} · GL net{" "}
            {formatMoney(bookNet, { showCurrency: false, accountingNegative: true })}
          </span>
          <div className="flex-1" />
          {!selectionValid && (selStatement.size > 0 || selBook.size > 0) && (
            <span className="text-[0.75rem] text-caution">
              {stmtNet === 0
                ? "Select entries that net to a non-zero amount."
                : "Statement and GL totals must be equal and the same cash direction."}
            </span>
          )}
          <Button
            variant="primary"
            disabled={!selectionValid || pending}
            onClick={() => run(() => matchSelectedAction(summary.id, [...selStatement], [...selBook]))}
          >
            Match selected
          </Button>
        </div>
      )}

      {/* Existing matches — removable only while in progress */}
      {workspace.matches.length > 0 && editable && (
        <div className="rc-no-print rounded-lg border border-paper-300 bg-white p-4">
          <p className="text-[0.8125rem] font-semibold text-ink-900">Matches in this reconciliation</p>
          <ul className="mt-2 divide-y divide-paper-200">
            {workspace.matches.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2 text-[0.8125rem]">
                <span className="flex-1 text-ink-700">
                  {m.statementTxnIds.length} statement ↔ {m.bookLineIds.length} GL ·{" "}
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

      {/* Step 8: summary */}
      <SummaryCard
        report={report}
        summary={summary}
        bridge={bridge}
        currency={currency}
        cardMoney={cardMoney}
        unmatchedStatement={unmatchedStatement}
        canComplete={inProgress && canWrite && summary.statementBalanceValid && bridge.differenceCents === 0}
        pending={pending}
        onComplete={() => run(() => completeReconciliationAction(summary.id, summary.version))}
      />
    </>
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

// ── Reconciliation summary ──────────────────────────────────────────────────

function SummaryCard({
  report,
  summary,
  bridge,
  currency,
  cardMoney,
  unmatchedStatement,
  canComplete,
  pending,
  onComplete,
}: {
  report: MonthEndReport;
  summary: ReconciliationWorkspace["summary"];
  bridge: ReturnType<typeof reconciliationBridge>;
  currency: string;
  cardMoney: (cents: number) => string;
  unmatchedStatement: number;
  canComplete: boolean;
  pending: boolean;
  onComplete: () => void;
}) {
  const plain = (c: number) => formatMoney(c, { showCurrency: false, accountingNegative: true });
  const inProgress = summary.status === "IN_PROGRESS";
  const calculated = summary.openingBalanceCents + summary.statementCreditsCents - summary.statementDebitsCents;

  // While in progress the lists are rebuilt from the current report; frozen ones
  // come from what was saved at completion.
  return (
    <Card className="rc-report p-6">
      <h2 className="text-[1.25rem] font-semibold text-ink-900">
        Reconciliation summary as of {formatDate(report.asOfIso)}
      </h2>
      {report.frozen && (
        <p className="mt-1 text-[0.75rem] text-muted-ink">
          Locked {summary.completedAt ? formatDate(summary.completedAt.slice(0, 10)) : ""} — this report is frozen and will not change.
        </p>
      )}

      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <div>
          <ReportTable title="Outstanding receipts / deposits in transit" currency={currency} rows={report.outstandingReceipts} empty="None — every GL receipt is on the statement." />
          <div className="mt-5">
            <ReportTable title="Outstanding payments" currency={currency} rows={report.outstandingPayments} empty="None — every GL payment is on the statement." />
          </div>

          {report.unmatchedStatementItems.length > 0 && (
            <div className="mt-5 rounded-lg border border-[color:var(--color-caution)]/30 bg-caution-soft p-3">
              <p className="text-[0.8125rem] font-semibold text-ink-900">
                Unmatched statement items — investigate or adjust
              </p>
              <p className="mt-0.5 text-[0.75rem] leading-5 text-ink-700">
                Bank movements with no entry in the GL. These are not timing differences: record a journal
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
        </div>

        <div className="text-[0.875rem]">
          <ReconLine
            label="Bank balance as per bank statement"
            note="opening + credits − debits"
            value={plain(bridge.statementBalanceCents)}
          />
          <ReconLine
            label="Outstanding bank transactions"
            note="GL receipts not matched with the statement"
            value={plain(bridge.outstandingReceiptsCents)}
          />
          <ReconLine
            label="Outstanding payments"
            note="GL payments not matched with the statement"
            value={plain(bridge.outstandingPaymentsSignedCents)}
          />
          <div className="my-2 border-t border-[#a9bdc9]" />
          <ReconLine label="Adjusted bank balance" value={cardMoney(bridge.adjustedBankBalanceCents)} bold />
          <ReconLine label="Bank balance as per GL" note={`GL balance on ${formatDate(report.asOfIso)}`} value={cardMoney(bridge.glBalanceCents)} />
          <div className="my-2 border-t border-[#a9bdc9]" />
          <ReconLine
            label="Difference"
            note="must be zero to close"
            value={plain(bridge.differenceCents)}
            bold
            accent={bridge.differenceCents !== 0}
          />

          <div className="mt-3">
            {bridge.differenceCents === 0 ? (
              <Badge tone="positive">Balanced</Badge>
            ) : (
              <Badge tone="caution">Out of balance</Badge>
            )}
          </div>

          {inProgress && (
            <>
              {!summary.statementBalanceValid && (
                <p className="mt-3 text-[0.75rem] text-caution">
                  Statement opening + credits − debits is {plain(calculated)}, but the closing balance entered is{" "}
                  {plain(summary.closingBalanceCents)}. Import the whole statement or correct the figures.
                </p>
              )}
              {unmatchedStatement > 0 && (
                <p className="mt-3 text-[0.75rem] text-muted-ink">
                  {unmatchedStatement} statement line{unmatchedStatement === 1 ? " is" : "s are"} not matched to the GL.
                </p>
              )}
              {bridge.differenceCents !== 0 && (
                <p className="mt-3 text-[0.75rem] text-caution">
                  The difference must be zero before this reconciliation can be closed.
                </p>
              )}
              <div className="rc-no-print mt-4 flex justify-end">
                <Button variant="primary" disabled={!canComplete || pending} onClick={onComplete}>
                  {pending ? "Closing…" : "Complete reconciliation"}
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
  note,
  value,
  bold,
  accent,
}: {
  label: string;
  note?: string;
  value: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={clsx("flex items-baseline justify-between gap-6 py-1", bold && "font-semibold")}>
      <span className={clsx(bold ? "text-ink-900" : "text-ink-800")}>
        {label}
        {note && <span className="block text-[0.6875rem] font-normal text-muted-ink">{note}</span>}
      </span>
      <span className={clsx("tnum", accent ? "text-maple-600" : bold ? "text-ink-950" : "text-ink-800")}>{value}</span>
    </div>
  );
}
