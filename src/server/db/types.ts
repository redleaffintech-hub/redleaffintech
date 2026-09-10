import "server-only";

/**
 * Plain-object shapes for the Firestore data layer (§31).
 *
 * These mirror the Prisma models field-for-field so call sites keep compiling as
 * repositories replace `db.<model>` one module at a time. `Date` is used at this
 * boundary; repositories convert Firestore `Timestamp` in and out. Fields Prisma
 * defaulted (`@default`) are required here — repositories apply the default on
 * create, so a stored/returned document always has them.
 *
 * Phase 1 covers: Company, Account, User, CompanyUser, AuditLog.
 */

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  businessNumber: string | null;
  gstNumber: string | null;
  qstNumber: string | null;
  pstNumber: string | null;
  province: string;
  country: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  baseCurrency: string;
  fiscalYearStartMonth: number;
  locale: string;
  industry: string | null;
  logoUrl: string | null;
  firmId: string | null;
  isReadOnly: boolean;
  archivedAt: Date | null;
  archivedById: string | null;
  archiveReason: string | null;
  enabledModules: string[];
  createdAt: Date;
  updatedAt: Date;

  // Document numbering
  invoicePrefix: string;
  nextInvoiceNumber: number;
  estimatePrefix: string;
  nextEstimateNumber: number;
  billPrefix: string;
  nextBillNumber: number;
  creditPrefix: string;
  nextCreditNumber: number;
  paymentPrefix: string;
  nextPaymentNumber: number;
  journalPrefix: string;
  nextJournalNumber: number;
  expensePrefix: string;
  nextExpenseNumber: number;
  employeePrefix: string;
  nextEmployeeNumber: number;
  payRunPrefix: string;
  nextPayRunNumber: number;

  // Preferences
  defaultPaymentTermsDays: number;
  defaultTaxInclusive: boolean;
  invoiceFooter: string | null;
}

export type NumberSequence =
  | "invoice"
  | "estimate"
  | "bill"
  | "credit"
  | "payment"
  | "journal"
  | "expense"
  | "employee"
  | "payRun";

export interface Account {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: string; // AccountType
  subtype: string;
  parentId: string | null;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  systemKey: string | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isPlatformAdmin: boolean;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  activeCompanyId: string | null;
  createdAt: Date;
  updatedAt: Date;

  platformAdminSince: Date | null;
  platformAdminSuspendedAt: Date | null;

  mustChangePassword: boolean;
  passwordChangedAt: Date | null;

  mfaSecret: string | null;
  mfaEnrolledAt: Date | null;
}

export interface CompanyUser {
  id: string;
  companyId: string;
  userId: string;
  role: string; // CompanyRole
  status: string; // ACTIVE | INVITED | SUSPENDED
  permissions: string | null;
  invitedAt: Date | null;
  acceptedAt: Date | null;
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  companyId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

// ── Phase 2: general ledger ──────────────────────────────────────────────────

export interface FiscalPeriod {
  id: string;
  companyId: string;
  fiscalYear: number;
  periodNumber: number;
  name: string;
  startDate: Date;
  endDate: Date;
  status: string; // OPEN | CLOSED | LOCKED
  closedAt: Date | null;
  closedById: string | null;
  reopenedAt: Date | null;
  notes: string | null;
}

export interface JournalLine {
  id: string;
  journalEntryId: string;
  companyId: string;
  date: Date;
  lineNo: number;
  accountId: string;
  accountType: string;
  description: string | null;
  debitCents: number;
  creditCents: number;
  customerId: string | null;
  vendorId: string | null;
  projectId: string | null;
  taxCodeId: string | null;
}

export interface JournalEntry {
  id: string;
  companyId: string;
  entryNo: string;
  date: Date;
  memo: string | null;
  sourceType: string;
  sourceId: string | null;
  sourceNumber: string | null;
  status: string; // DRAFT | POSTED | REVERSED
  isAdjusting: boolean;
  reversalOfId: string | null;
  fiscalPeriodId: string | null;
  totalDebitCents: number;
  totalCreditCents: number;
  createdById: string | null;
  postedAt: Date | null;
  createdAt: Date;
}

/** A posted entry together with its lines, as callers that used `include` expect. */
export interface JournalEntryWithLines extends JournalEntry {
  lines: JournalLine[];
}

/**
 * `companies/{companyId}/accountPeriodBalances/{accountId}_{YYYYMM}` — the
 * reporting roll-up that replaces `groupBy(accountId) + _sum(...)` over
 * journalLines. Incremented inside every posting transaction (§4).
 */
export interface AccountPeriodBalance {
  id: string; // `${accountId}_${YYYYMM}`
  accountId: string;
  accountType: string;
  year: number;
  month: number; // 1-12
  debitCents: number;
  creditCents: number;
}
