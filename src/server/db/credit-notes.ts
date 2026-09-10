import "server-only";

import { makeDocRepo } from "./_doc-repo";
import type { CreditNote } from "./types";

/**
 * `companies/{companyId}/creditNotes/{id}` — customer credit notes and vendor
 * credits share one shape (§8, §9); `type` discriminates. Lines embedded.
 * Replaces `db.creditNote.*`.
 */
export const creditNotes = makeDocRepo<CreditNote>("creditNotes", [
  "issueDate",
  "postedAt",
  "createdAt",
  "updatedAt",
]);
