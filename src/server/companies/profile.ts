import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/**
 * The document-letterhead / settings field set, request-deduplicated
 * (§ perf review, 16 Sep 2026).
 *
 * `requireCompany()`'s CompanyContext already carries a handful of these
 * fields (name, legalName, province, gstNumber, qstNumber, pstNumber,
 * businessNumber, logoUrl, fiscalYearStartMonth) for auth/tenant resolution
 * — but nine separate call sites across the app (customer/invoice/quote/
 * credit-note pages and actions, the dashboard, the fiscal calendar) each
 * fired their own extra `db.company.findUniqueOrThrow` for the wider set —
 * address, contact details, per-document footers, tax-collection status —
 * that a printed document or a report needs on top of that. Several of
 * those ran on every single dashboard or document-page load. This is the
 * one place that query happens now; `cache()` collapses repeat calls with
 * the same companyId to a single query within a request, and every caller
 * just reads whichever subset of the (superset) result it needs.
 */
export const getCompanyProfile = cache(async (companyId: string) => {
  return db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      name: true, legalName: true, addressLine1: true, addressLine2: true, city: true, province: true,
      postalCode: true, businessNumber: true, gstNumber: true, qstNumber: true, pstNumber: true,
      email: true, phone: true, website: true, logoUrl: true,
      invoiceFooter: true, quoteFooter: true, creditNoteFooter: true,
      gstHstStatus: true, qstStatus: true, pstStatus: true,
      fiscalYearStartMonth: true,
    },
  });
});
