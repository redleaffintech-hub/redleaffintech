import "server-only";

import { makeDocRepo } from "./_doc-repo";
import type { Estimate } from "./types";

/** `companies/{companyId}/estimates/{id}` — lines embedded (§8). Replaces `db.estimate.*`. */
export const estimates = makeDocRepo<Estimate>("estimates", [
  "issueDate",
  "expiryDate",
  "createdAt",
  "updatedAt",
]);
