/**
 * The bank reconciliation bridge, in integer cents. Pure and client-safe: the
 * reconcile screen and the server's completion check use this one function, so the
 * figure the user sees is the figure that decides whether they can close.
 *
 *   bank balance per statement     closing balance (= opening + credits − debits)
 *   + outstanding receipts         GL deposits not on the statement
 *   − outstanding payments         GL payments not on the statement (shown negative)
 *   = adjusted bank balance        compared with the GL balance on the date
 *
 * Statement debits/credits are the bank's view: a deposit is a credit.
 */

export interface ReconciliationBridgeInput {
  statementBalanceCents: number;
  /** Positive total of unmatched GL debits to the bank account. */
  outstandingReceiptsCents: number;
  /** Positive total of unmatched GL credits to the bank account. */
  outstandingPaymentsCents: number;
  glBalanceCents: number;
}

export interface ReconciliationBridge {
  statementBalanceCents: number;
  outstandingReceiptsCents: number;
  /** Signed: payments reduce the bank balance, so this is ≤ 0. */
  outstandingPaymentsSignedCents: number;
  glBalanceCents: number;
  adjustedBankBalanceCents: number;
  differenceCents: number;
}

export function reconciliationBridge(input: ReconciliationBridgeInput): ReconciliationBridge {
  // 0 − x rather than −x: negating zero gives −0, which prints as "-0.00".
  const outstandingPaymentsSignedCents = 0 - input.outstandingPaymentsCents;
  const adjustedBankBalanceCents =
    input.statementBalanceCents + input.outstandingReceiptsCents + outstandingPaymentsSignedCents;
  return {
    statementBalanceCents: input.statementBalanceCents,
    outstandingReceiptsCents: input.outstandingReceiptsCents,
    outstandingPaymentsSignedCents,
    glBalanceCents: input.glBalanceCents,
    adjustedBankBalanceCents,
    differenceCents: adjustedBankBalanceCents - input.glBalanceCents,
  };
}

/** Statement balance from the statement's own lines: opening + credits − debits. */
export function statementBalanceCents(openingCents: number, creditsCents: number, debitsCents: number): number {
  return openingCents + creditsCents - debitsCents;
}
