/**
 * Customer / vendor opening balances.
 *
 * The balance a party owes (or is owed) on the day the books start is carried by
 * a REAL posted document, not a loose number on the party record:
 *   customer  ->  an invoice   Dr Accounts Receivable / Cr Opening Balance Equity
 *   vendor    ->  a bill       Dr Opening Balance Equity / Cr Accounts Payable
 * That is what lets aging, statements, the A/R and A/P control-account
 * reconciliation and ordinary payment allocation treat it like any other open
 * item. Party.openingBalanceCents mirrors the amount for display, and
 * openingBalanceDocId points at the document so an edit can void and re-issue it
 * (never stack a second one on top — that would double count).
 */

import { db } from "@/lib/db";
import { SYSTEM_ACCOUNTS } from "@/lib/enums";
import { toUtcDay } from "@/lib/dates";
import { getSystemAccount } from "@/server/accounting/ledger";
import { createInvoice, voidInvoice } from "./invoices";
import { createBill, voidBill } from "./bills";

export type OpeningParty = "CUSTOMER" | "VENDOR";

export async function setOpeningBalance(input: {
  companyId: string;
  party: OpeningParty;
  partyId: string;
  amountCents: number;
  date: Date | string;
  userId?: string | null;
}): Promise<void> {
  const { companyId, party, partyId, userId } = input;
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) throw new Error("The opening balance cannot be negative.");
  const date = toUtcDay(input.date);

  const record =
    party === "CUSTOMER"
      ? await db.customer.findFirst({ where: { id: partyId, companyId }, select: { openingBalanceCents: true, openingBalanceDate: true, openingBalanceDocId: true } })
      : await db.vendor.findFirst({ where: { id: partyId, companyId }, select: { openingBalanceCents: true, openingBalanceDate: true, openingBalanceDocId: true } });
  if (!record) throw new Error(`That ${party === "CUSTOMER" ? "customer" : "vendor"} does not exist.`);

  const unchanged =
    record.openingBalanceCents === input.amountCents &&
    (input.amountCents === 0 || record.openingBalanceDate?.getTime() === date.getTime());
  if (unchanged) return;

  // Retire the previous opening document first. voidInvoice/voidBill refuse when a payment is applied,
  // which is exactly the guard we want: the user must unallocate before changing the opening balance.
  if (record.openingBalanceDocId) {
    try {
      if (party === "CUSTOMER") await voidInvoice(record.openingBalanceDocId, companyId, userId);
      else await voidBill(record.openingBalanceDocId, companyId, userId);
    } catch (error) {
      const message = (error as Error).message;
      if (/already void/i.test(message)) {
        // fall through — nothing to retire
      } else if (/unapply/i.test(message)) {
        throw new Error("Payments are already applied to this opening balance. Unallocate them before changing it.");
      } else {
        throw error;
      }
    }
  }

  let docId: string | null = null;
  if (input.amountCents > 0) {
    const obe = await db.$transaction((tx) => getSystemAccount(tx, companyId, SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY));
    const line = { accountId: obe.id, description: "Opening balance", quantityMilli: 1000, unitPriceCents: input.amountCents, taxCodeId: null };
    if (party === "CUSTOMER") {
      const invoice = await createInvoice({
        companyId, customerId: partyId, issueDate: date, dueDate: date, memo: "Opening balance", lines: [line], userId, post: true,
      });
      docId = invoice.id;
    } else {
      const bill = await createBill({
        companyId, vendorId: partyId, issueDate: date, dueDate: date, memo: "Opening balance", lines: [line], userId, post: true,
      });
      docId = bill.id;
    }
  }

  const data = { openingBalanceCents: input.amountCents, openingBalanceDate: input.amountCents > 0 ? date : null, openingBalanceDocId: docId };
  if (party === "CUSTOMER") await db.customer.update({ where: { id: partyId }, data });
  else await db.vendor.update({ where: { id: partyId }, data });
}
