import { db, type Tx } from "@/lib/db";
import { addDays, addMonths, fiscalYearOf, fiscalYearRange, utcDate } from "@/lib/dates";

/**
 * Changing a company's fiscal year start.
 *
 * The hard constraint: posted entries and the periods they sit in are history,
 * and history does not move. So a change is applied PROSPECTIVELY — every
 * existing fiscal period keeps its dates, every posted entry keeps its period,
 * and the new basis begins on a date the user chooses.
 *
 * That usually leaves a gap between the end of the last old-basis period and
 * the start of the first new-basis year. Those months are the transition block.
 * They are created as additional periods of the OUTGOING fiscal year rather
 * than as a fiscal year of their own, because the year number is derived from
 * the start month: a January-to-March stub would compute to the same fiscal
 * year as the April year that follows it and collide on
 * `@@unique([companyId, fiscalYear, periodNumber])`. Carrying them as periods
 * 13+ of the year they extend is unambiguous and keeps coverage gapless.
 *
 * Nothing here reopens, edits or deletes a closed or locked period.
 */

export interface FiscalChangePlan {
  currentStartMonth: number;
  newStartMonth: number;
  /** Journal entries already posted; drives whether a reason is required. */
  postedEntries: number;
  /** Fiscal periods that exist today. None of them are modified. */
  existingPeriods: number;
  closedOrLockedPeriods: number;
  /** First calendar date reported on the new basis. */
  effectiveDate: Date;
  effectiveFiscalYear: number;
  /** The stub between the two bases, when one is needed. */
  transition: { start: Date; end: Date; months: number; fiscalYear: number } | null;
  /** First full year on the new basis. */
  firstNewYear: { fiscalYear: number; start: Date; end: Date };
  /** True when nothing has been posted and the calendar can simply be rebuilt. */
  immediate: boolean;
  /** Reasons the change cannot proceed. Empty means it can. */
  blockers: string[];
}

/** Latest date covered by an existing period, or null when there are none. */
async function lastCoveredDate(client: Tx | typeof db, companyId: string): Promise<Date | null> {
  const last = await client.fiscalPeriod.findFirst({
    where: { companyId },
    orderBy: { endDate: "desc" },
    select: { endDate: true },
  });
  return last?.endDate ?? null;
}

/**
 * Work out what a change would do, without doing it.
 *
 * `effectiveYear` is the calendar year in which the new basis starts. When it
 * is omitted the earliest safe year is chosen: the first occurrence of the new
 * start month strictly after everything already covered.
 */
export async function planFiscalYearChange(
  companyId: string,
  newStartMonth: number,
  effectiveYear?: number,
): Promise<FiscalChangePlan> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { fiscalYearStartMonth: true },
  });
  const currentStartMonth = company.fiscalYearStartMonth;

  const [postedEntries, existingPeriods, closedOrLockedPeriods, covered] = await Promise.all([
    db.journalEntry.count({ where: { companyId } }),
    db.fiscalPeriod.count({ where: { companyId } }),
    db.fiscalPeriod.count({ where: { companyId, status: { in: ["CLOSED", "LOCKED"] } } }),
    lastCoveredDate(db, companyId),
  ]);

  const blockers: string[] = [];
  if (newStartMonth < 1 || newStartMonth > 12 || !Number.isInteger(newStartMonth)) {
    blockers.push("Choose a month between January and December.");
  }

  // With nothing posted the calendar is not yet evidence of anything, so it can
  // be rebuilt in place from the new month.
  const immediate = postedEntries === 0;

  // The new basis must start after everything already covered, so no existing
  // period is overlapped or superseded.
  const earliestStart = covered ? addDays(covered, 1) : utcDate(new Date().getUTCFullYear(), newStartMonth, 1);

  function firstStartOnOrAfter(boundary: Date): Date {
    let candidate = utcDate(boundary.getUTCFullYear(), newStartMonth, 1);
    if (candidate < boundary) candidate = addMonths(candidate, 12);
    return candidate;
  }

  let effectiveDate: Date;
  if (immediate) {
    // Rebuild the current year on the new basis.
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

  // The stub, if the old calendar stops before the new one starts.
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
        // Carried as extra periods of the outgoing year — see the note above.
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

/** Monthly period rows for a span, numbered from `startNumber`. */
function monthlyPeriods(
  companyId: string,
  fiscalYear: number,
  start: Date,
  monthCount: number,
  startNumber: number,
  namePrefix = "",
) {
  const rows = [];
  for (let i = 0; i < monthCount; i++) {
    const periodStart = addMonths(start, i);
    const periodEnd = addDays(addMonths(periodStart, 1), -1);
    rows.push({
      companyId,
      fiscalYear,
      periodNumber: startNumber + i,
      name:
        namePrefix +
        new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(periodStart),
      startDate: periodStart,
      endDate: periodEnd,
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

export interface ApplyFiscalChangeResult {
  plan: FiscalChangePlan;
  periodsCreated: number;
  periodsRemoved: number;
}

/**
 * Apply the change.
 *
 * Runs inside the caller's transaction so the company row and its periods move
 * together or not at all — a company whose start month says April while its
 * periods still run January to December is worse than either state alone.
 */
export async function applyFiscalYearChange(
  tx: Tx,
  input: ApplyFiscalChangeInput,
  plan: FiscalChangePlan,
): Promise<ApplyFiscalChangeResult> {
  if (plan.blockers.length > 0) throw new Error(plan.blockers[0]);

  let periodsCreated = 0;
  let periodsRemoved = 0;

  if (plan.immediate) {
    // Nothing posted. Any period that carries no entries and is still open can
    // be replaced; anything else is left exactly where it is.
    const disposable = await tx.fiscalPeriod.findMany({
      where: { companyId: input.companyId, status: "OPEN", journalEntries: { none: {} } },
      select: { id: true, fiscalYear: true },
    });
    const years = [...new Set(disposable.map((p) => p.fiscalYear))].sort();
    if (disposable.length > 0) {
      await tx.fiscalPeriod.deleteMany({ where: { id: { in: disposable.map((p) => p.id) } } });
      periodsRemoved = disposable.length;
    }

    // Rebuild the same fiscal years on the new basis, plus the effective year
    // when it was not among them.
    const rebuild = [...new Set([...years, plan.effectiveFiscalYear])].sort();
    for (const year of rebuild) {
      const clash = await tx.fiscalPeriod.count({ where: { companyId: input.companyId, fiscalYear: year } });
      if (clash > 0) continue; // something survived here; do not overlap it
      const { start } = fiscalYearRange(year, plan.newStartMonth);
      const rows = monthlyPeriods(input.companyId, year, start, 12, 1);
      await tx.fiscalPeriod.createMany({ data: rows });
      periodsCreated += rows.length;
    }
  } else {
    // Posted history exists. Nothing is deleted; the calendar is extended.
    if (plan.transition) {
      const existingNumbers = await tx.fiscalPeriod.findMany({
        where: { companyId: input.companyId, fiscalYear: plan.transition.fiscalYear },
        select: { periodNumber: true },
        orderBy: { periodNumber: "desc" },
        take: 1,
      });
      const startNumber = (existingNumbers[0]?.periodNumber ?? 0) + 1;
      const rows = monthlyPeriods(
        input.companyId,
        plan.transition.fiscalYear,
        plan.transition.start,
        plan.transition.months,
        startNumber,
        "Transition — ",
      );
      await tx.fiscalPeriod.createMany({ data: rows });
      periodsCreated += rows.length;
    }

    const alreadyThere = await tx.fiscalPeriod.count({
      where: { companyId: input.companyId, fiscalYear: plan.effectiveFiscalYear },
    });
    if (alreadyThere === 0) {
      const rows = monthlyPeriods(
        input.companyId,
        plan.effectiveFiscalYear,
        plan.firstNewYear.start,
        12,
        1,
      );
      await tx.fiscalPeriod.createMany({ data: rows });
      periodsCreated += rows.length;
    }
  }

  await tx.company.update({
    where: { id: input.companyId },
    data: { fiscalYearStartMonth: plan.newStartMonth },
  });

  await tx.fiscalCalendarChange.create({
    data: {
      companyId: input.companyId,
      previousStartMonth: plan.currentStartMonth,
      newStartMonth: plan.newStartMonth,
      effectiveFiscalYear: plan.effectiveFiscalYear,
      effectiveDate: plan.effectiveDate,
      reason: input.reason?.trim() || null,
      postedEntryCount: plan.postedEntries,
      periodsCreated,
      transitionStart: plan.transition?.start ?? null,
      transitionEnd: plan.transition?.end ?? null,
      changedById: input.userId,
    },
  });

  return { plan, periodsCreated, periodsRemoved };
}

/**
 * The real boundaries of a fiscal year for this company.
 *
 * Stored periods win wherever they exist, which is what stops a historical
 * report shifting when the company adopts a new start month for a future year.
 * Only years that were never generated fall back to computing from the current
 * setting.
 */
export async function resolveFiscalYearRange(
  companyId: string,
  fiscalYear: number,
  fallbackStartMonth: number,
): Promise<{ start: Date; end: Date }> {
  const bounds = await db.fiscalPeriod.aggregate({
    where: { companyId, fiscalYear },
    _min: { startDate: true },
    _max: { endDate: true },
  });
  if (bounds._min.startDate && bounds._max.endDate) {
    return { start: bounds._min.startDate, end: bounds._max.endDate };
  }
  return fiscalYearRange(fiscalYear, fallbackStartMonth);
}
