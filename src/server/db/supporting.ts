import "server-only";

import { makeDocRepo } from "./_doc-repo";
import type {
  Attachment,
  Budget,
  FiscalCalendarChange,
  Notification,
  Project,
  RecurringTemplate,
} from "./types";

/** Projects, budgets, recurring templates, attachments, notifications, fiscal
 *  calendar changes (§19–22, §14). */

export const projects = makeDocRepo<Project>("projects", ["startDate", "endDate", "createdAt"], {
  embedLines: false,
  touchUpdatedAt: false,
});

export const budgets = makeDocRepo<Budget>("budgets", ["createdAt"], { touchUpdatedAt: false });

export const recurring = makeDocRepo<RecurringTemplate>(
  "recurring",
  ["nextRunDate", "endDate", "lastRunAt", "createdAt"],
  { embedLines: false, touchUpdatedAt: false },
);

export const attachments = makeDocRepo<Attachment>("attachments", ["createdAt"], {
  embedLines: false,
  touchUpdatedAt: false,
});

export const notifications = makeDocRepo<Notification>("notifications", ["createdAt"], {
  embedLines: false,
  touchUpdatedAt: false,
});

export const fiscalCalendarChanges = makeDocRepo<FiscalCalendarChange>(
  "fiscalCalendarChanges",
  ["effectiveDate", "transitionStart", "transitionEnd", "createdAt"],
  { embedLines: false, touchUpdatedAt: false },
);

/** Templates whose next run is due on or before `asOf`. */
export async function dueRecurringTemplates(
  companyId: string,
  asOf: Date,
): Promise<RecurringTemplate[]> {
  return (
    await recurring.list(companyId, { where: [["isActive", "==", true]], orderBy: "nextRunDate" })
  ).filter((t) => t.nextRunDate <= asOf && (!t.endDate || t.endDate >= asOf));
}
