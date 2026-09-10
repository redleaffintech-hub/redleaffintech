import "server-only";

import { makeDocRepo } from "./_doc-repo";
import { sub } from "./firestore";
import type { Invoice } from "./types";

/**
 * `companies/{companyId}/invoices/{id}` — lines embedded, snapshotted bill-to /
 * ship-to on the document (§8). Replaces `db.invoice.*` / `db.invoiceLine.*`.
 */
export const invoices = makeDocRepo<Invoice>("invoices", [
  "issueDate",
  "dueDate",
  "postedAt",
  "sentAt",
  "voidedAt",
  "createdAt",
  "updatedAt",
]);

/** Open invoices for a customer, most recent first (customer detail page). */
export async function listInvoicesForCustomer(
  companyId: string,
  customerId: string,
): Promise<Invoice[]> {
  return invoices.list(companyId, {
    where: [["customerId", "==", customerId]],
    orderBy: "issueDate",
    direction: "desc",
  });
}

/** Flip open invoices past their due date to OVERDUE (nightly-job equivalent). */
export async function markOverdueInvoices(companyId: string, asOf = new Date()): Promise<number> {
  const snap = await sub(companyId, "invoices")
    .where("status", "in", ["SENT", "PARTIALLY_PAID"])
    .get();
  const batch = sub(companyId, "invoices").firestore.batch();
  let n = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const due = d.dueDate?.toDate?.() ?? new Date(d.dueDate);
    if (due < asOf && (d.balanceCents ?? 0) > 0) {
      batch.update(doc.ref, { status: "OVERDUE" });
      n++;
    }
  }
  if (n > 0) await batch.commit();
  return n;
}
