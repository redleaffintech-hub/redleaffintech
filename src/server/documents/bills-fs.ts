import "server-only";

/**
 * Vendor bills (§9) — Firestore implementation.
 *
 * Phase 4 delivers only the status-refresh helper the payment flow needs. The
 * create / post / void bill flows (which also touch the tax engine and inventory
 * receipt costing) land in Phase 5 alongside expenses and credit notes.
 */

import { bills } from "@/server/db/bills";
import type { Tx } from "@/server/db/firestore";

/** Recompute paid / balance / status from the allocations recorded against a bill. */
export async function refreshBillStatusTx(
  tx: Tx,
  companyId: string,
  billId: string,
  allocations: { amountCents: number; kind: string }[],
): Promise<void> {
  const bill = await bills.getTx(tx, companyId, billId);
  if (!bill || bill.status === "VOID" || bill.status === "DRAFT") return;

  const settled = allocations.reduce((s, a) => s + a.amountCents, 0);
  const cashPaid = allocations
    .filter((a) => a.kind === "PAYMENT")
    .reduce((s, a) => s + a.amountCents, 0);
  const balance = bill.totalCents - settled;

  let status = bill.status;
  if (balance <= 0) status = "PAID";
  else if (settled > 0) status = "PARTIALLY_PAID";
  else status = new Date() > bill.dueDate ? "OVERDUE" : "OPEN";

  bills.updateTx(tx, companyId, billId, {
    amountPaidCents: cashPaid,
    balanceCents: balance,
    status,
  });
}
