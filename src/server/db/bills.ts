import "server-only";

import { makeDocRepo } from "./_doc-repo";
import type { Bill } from "./types";

/** `companies/{companyId}/bills/{id}` — lines embedded (§9). Replaces `db.bill.*`. */
export const bills = makeDocRepo<Bill>("bills", [
  "issueDate",
  "dueDate",
  "approvedAt",
  "postedAt",
  "voidedAt",
  "createdAt",
  "updatedAt",
]);

export async function listBillsForVendor(companyId: string, vendorId: string): Promise<Bill[]> {
  return bills.list(companyId, {
    where: [["vendorId", "==", vendorId]],
    orderBy: "issueDate",
    direction: "desc",
  });
}
