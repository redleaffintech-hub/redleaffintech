import "server-only";

/**
 * Changing a company's fiscal year start (§14) — Firestore implementation.
 *
 * The change is prospective: existing periods and the entries in them are
 * history and do not move. `planFiscalYearChange` works out what a change would
 * do (pure reads); `applyFiscalYearChange` does it in one transaction — reads
 * everything it needs up front, then writes (Firestore forbids reads after
 * writes).
 */

import { addDays, addMonths, fiscalYearOf, fiscalYearRange, utcDate } from "@/lib/dates";
import { getCompanyOrThrow, updateCompanyTx } from "@/server/db/companies";
import { listFiscalPeriods } from "@/server/db/fiscal-periods";
import { fiscalCalendarChanges } from "@/server/db/supporting";
import { runTransaction, sub, toTimestamp } from "@/server/db/firestore";

export interface FiscalChangePlan {
  currentStartMonth: number;
  newStartMonth: number;
  postedEntries: number;
  existingPeriods: number;
  closedOrLockedPeriods: number;
  effectiveDate: Date;
  effectiveFiscalYear: number;
  transition: { start: Date; end: Date; months: number; fiscalYear: number } | null;
  firstNewYear: { fiscalYear: number; start: Date; end: Date };
  immediate: boolean;
  blockers: string[];
}

async function journalEntryCount(companyId: string): Promise<number> {
  return (await sub(companyId, "journalEntries").get()).size;
}

export async function planFiscalYearChange(
  companyId: string,
  newStartMonth: number,
  effectiveYear?: number,
): Promise<FiscalChangePlan> {
  const company = await getCompanyOrThrow(companyId);
  const currentStartMonth = company.fiscalYearStartMonth;

  const [postedEntries, periods] = await Promise.all([
    journalEntryCount(companyId),
    listFiscalPeriods(companyId),
  ]);
  const existingPeriods = periods.length;
  const closedOrLockedPeriods = periods.filter((p) => ["CLOSED", "LOCKED"].includes(p.status)).length;
  const covered =
    periods.length > 0
      ? periods.map((p) => p.endDate).sort((a, b) => b.getTime() - a.getTime())[0]
      : null;

  const blockers: string[] = [];
  if (newStartMonth < 1 || newStartMonth > 12 || !Number.isInteger(newStartMonth)) {
    blockers.push("Choose a month between January and December.");
  }

  const immediate = postedEntries === 0;
  const earliestStart = covered
    ? addDays(covered, 1)
    : utcDate(new Date().getUTCFullYear(), newStartMonth, 1);

  const firstStartOnOrAfter = (boundary: Date): Date => {
    let candidate = utcDate(boundary.getUTCFullYear(), newStartMonth, 1);
    if (candidate < boundary) candidate = addMonths(candidate, 12);
    return candidate;
  };

  let effectiveDate: Date;
  if (immediate) {
    effectiveDate = utcDate(fiscalYearOf(new Date(), newStartMonth), newStartMonth, 1);
  } else if (effectiveYear !== undefined) {
    effectiveDate = utcDate(effectiveYear, newStartMonth, 1);
    if (covered && effectiveDate <= covered) {
      blockers.push(
        `The new basis must begin after ${covered.toISOString().slice(0, 10)}, the end of the last existing fiscal period. Choose a later year.`,
      );
    }
  } else {
    effectiveDate = firstStartOnOrAfter(earliestStart);
  }

  const effectiveFiscalYear = fiscalYearOf(effectiveDate, newStartMonth);

  let transition: FiscalChangePlan["transition"] = null;
  if (!immediate && covered) {
    const stubStart = addDays(covered, 1);
    if (stubStart < effectiveDate) {
      let months = 0;
      for (let cursor = stubStart; cursor < effectiveDate; cursor = addMonths(cursor, 1)) months++;
      transition = {
        start: stubStart,
        end: addDays(effectiveDate, -1),
        months,
        fiscalYear: fiscalYearOf(covered, currentStartMonth),
      };
      if (months > 11) {
        blockers.push(
          `That effective year would leave a ${months}-month gap. A transition block must be shorter than a full year — choose an earlier effective year.`,
        );
      }
    }
  }

  const firstNewRange = fiscalYearRange(effectiveFiscalYear, newStartMonth);
  return {
    currentStartMonth,
    newStartMonth,
    postedEntries,
    existingPeriods,
    closedOrLockedPeriods,
    effectiveDate,
    effectiveFiscalYear,
    transition,
    firstNewYear: { fiscalYear: effectiveFiscalYear, start: firstNewRange.start, end: firstNewRange.end },
    immediate,
    blockers,
  };
}

interface PeriodRow {
  fiscalYear: number;
  periodNumber: number;
  name: string;
  startDate: Date;
  endDate: Date;
  status: string;
}

function monthlyPeriods(
  fiscalYear: number,
  start: Date,
  monthCount: number,
  startNumber: number,
  namePrefix = "",
): PeriodRow[] {
  const rows: PeriodRow[] = [];
  const fmt = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
  for (let i = 0; i < monthCount; i++) {
    const periodStart = addMonths(start, i);
    rows.push({
      fiscalYear,
      periodNumber: startNumber + i,
      name: namePrefix + fmt.format(periodStart),
      startDate: periodStart,
      endDate: addDays(addMonths(periodStart, 1), -1),
      status: "OPEN",
    });
  }
  return rows;
}

export interface ApplyFiscalChangeInput {
  companyId: string;
  userId: string;
  newStartMonth: number;
  effectiveYear?: number;
  reason?: string;
}

export async function applyFiscalYearChange(
  input: ApplyFiscalChangeInput,
  plan: FiscalChangePlan,
): Promise<{ plan: FiscalChangePlan; periodsCreated: number; periodsRemoved: number }> {
  if (plan.blockers.length > 0) throw new Error(plan.blockers[0]);
  const { companyId } = input;

  const periods = await listFiscalPeriods(companyId);
  const yearsPresent = new Set(periods.map((p) => p.fiscalYear));

  const toRemove: string[] = [];
  const toCreate: PeriodRow[] = [];

  if (plan.immediate) {
    // Open periods carrying no entries can be replaced.
    const openPeriods = periods.filter((p) => p.status === "OPEN");
    const withoutEntries: typeof openPeriods = [];
    for (const p of openPeriods) {
      const has = await sub(companyId, "journalEntries")
        .where("fiscalPeriodId", "==", p.id)
        .limit(1)
        .get();
      if (has.empty) withoutEntries.push(p);
    }
    toRemove.push(...withoutEntries.map((p) => p.id));
    const survivingYears = new Set(
      periods.filter((p) => !toRemove.includes(p.id)).map((p) => p.fiscalYear),
    );
    const rebuildYears = [
      ...new Set([...withoutEntries.map((p) => p.fiscalYear), plan.effectiveFiscalYear]),
    ].sort();
    for (const year of rebuildYears) {
      if (survivingYears.has(year)) continue;
      const { start } = fiscalYearRange(year, plan.newStartMonth);
      toCreate.push(...monthlyPeriods(year, start, 12, 1));
    }
  } else {
    if (plan.transition) {
      const startNumber =
        Math.max(
          0,
          ...periods
            .filter((p) => p.fiscalYear === plan.transition!.fiscalYear)
            .map((p) => p.periodNumber),
        ) + 1;
      toCreate.push(
        ...monthlyPeriods(
          plan.transition.fiscalYear,
          plan.transition.start,
          plan.transition.months,
          startNumber,
          "Transition — ",
        ),
      );
    }
    if (!yearsPresent.has(plan.effectiveFiscalYear)) {
      toCreate.push(...monthlyPeriods(plan.effectiveFiscalYear, plan.firstNewYear.start, 12, 1));
    }
  }

  await runTransaction(async (tx) => {
    for (const id of toRemove) tx.delete(sub(companyId, "fiscalPeriods").doc(id));
    for (const row of toCreate) {
      const id = `${row.fiscalYear}-${String(row.periodNumber).padStart(2, "0")}`;
      tx.set(sub(companyId, "fiscalPeriods").doc(id), {
        companyId,
        fiscalYear: row.fiscalYear,
        periodNumber: row.periodNumber,
        name: row.name,
        startDate: toTimestamp(row.startDate),
        endDate: toTimestamp(row.endDate),
        status: row.status,
        closedAt: null,
        closedById: null,
        reopenedAt: null,
        notes: null,
      });
    }
    updateCompanyTx(tx, companyId, { fiscalYearStartMonth: plan.newStartMonth });
  });

  await fiscalCalendarChanges.create({
    companyId,
    previousStartMonth: plan.currentStartMonth,
    newStartMonth: plan.newStartMonth,
    effectiveFiscalYear: plan.effectiveFiscalYear,
    effectiveDate: plan.effectiveDate,
    reason: input.reason?.trim() || null,
    postedEntryCount: plan.postedEntries,
    periodsCreated: toCreate.length,
    transitionStart: plan.transition?.start ?? null,
    transitionEnd: plan.transition?.end ?? null,
    changedById: input.userId,
  } as Parameters<typeof fiscalCalendarChanges.create>[0]);

  return { plan, periodsCreated: toCreate.length, periodsRemoved: toRemove.length };
}

export async function resolveFiscalYearRange(
  companyId: string,
  fiscalYear: number,
  fallbackStartMonth: number,
): Promise<{ start: Date; end: Date }> {
  const periods = await listFiscalPeriods(companyId, { fiscalYear });
  if (periods.length > 0) {
    return {
      start: periods.map((p) => p.startDate).sort((a, b) => a.getTime() - b.getTime())[0],
      end: periods.map((p) => p.endDate).sort((a, b) => b.getTime() - a.getTime())[0],
    };
  }
  return fiscalYearRange(fiscalYear, fallbackStartMonth);
}
