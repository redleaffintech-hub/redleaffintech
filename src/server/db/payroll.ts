import "server-only";

import { makeDocRepo } from "./_doc-repo";
import type { PayRun } from "./types";

/** Payroll pay runs (§payroll) — lines embedded. Replaces `db.payRun.*`. */
export const payRuns = makeDocRepo<PayRun>(
  "payRuns",
  ["payPeriodStart", "payPeriodEnd", "payDate", "postedAt", "createdAt", "updatedAt"],
);
