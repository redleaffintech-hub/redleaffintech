/**
 * Tax-suppression policy (issues 1 and 5, 15 Sep 2026 review).
 *
 * Resolves which TaxComponent kinds a document must NOT charge, from two
 * independent, server-trusted sources — never from anything the client
 * submits. This is the single place that combines them, so preview, draft
 * save, and post can never disagree about which components apply.
 *
 * Deliberately scoped: HST and QST are never suppressed by a customer's
 * gstExempt/pstExempt flags. The review document explicitly warns against
 * inferring HST policy from "GST" or treating QST as "PST" — customer-level
 * HST/QST exemption is an unresolved policy question, out of scope for this
 * round, and is NOT approximated here.
 */

import { calculateTax, type TaxResult, type TaxCodeSpec } from "@/server/tax/engine";

export interface TaxPolicyCompany {
  gstHstStatus: string;
  qstStatus: string;
  pstStatus: string;
}

export interface TaxPolicyCustomer {
  gstExempt: boolean;
  pstExempt: boolean;
}

const SUPPRESSING_STATUSES = new Set(["EXEMPT", "NOT_APPLICABLE"]);

/**
 * @param company   the active company's three collection-status fields
 * @param customer  the document's party, if it carries exemption flags
 *   (Customer only — vendors/purchase documents are unaffected by this
 *   policy; see the module comment on why purchase-tax logic is untouched)
 */
export function resolveSuppressedKinds(
  company: TaxPolicyCompany,
  customer?: TaxPolicyCustomer | null,
): Set<string> {
  const suppressed = new Set<string>();

  if (SUPPRESSING_STATUSES.has(company.gstHstStatus)) {
    suppressed.add("GST");
    suppressed.add("HST");
  }
  if (SUPPRESSING_STATUSES.has(company.qstStatus)) {
    suppressed.add("QST");
  }
  if (SUPPRESSING_STATUSES.has(company.pstStatus)) {
    suppressed.add("PST");
    suppressed.add("RST");
  }

  if (customer?.gstExempt) suppressed.add("GST");
  if (customer?.pstExempt) {
    suppressed.add("PST");
    suppressed.add("RST");
  }

  return suppressed;
}

/** Convenience wrapper for a single-line preview/recalculation call site. */
export function calculateTaxWithPolicy(
  taxCode: TaxCodeSpec | null | undefined,
  amountCents: number,
  inclusive: boolean,
  transactionDate: Date,
  company: TaxPolicyCompany,
  customer?: TaxPolicyCustomer | null,
): TaxResult {
  return calculateTax(taxCode, amountCents, inclusive, transactionDate, resolveSuppressedKinds(company, customer));
}
