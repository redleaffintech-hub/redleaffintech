import "server-only";

import { makeDocRepo } from "./_doc-repo";
import type { Expense } from "./types";

/** `companies/{companyId}/expenses/{id}` — lines embedded (§10). Replaces `db.expense.*`. */
export const expenses = makeDocRepo<Expense>("expenses", [
  "date",
  "approvedAt",
  "postedAt",
  "createdAt",
  "updatedAt",
]);
