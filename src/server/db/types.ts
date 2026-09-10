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

// ── Phase 3: master data + documents ────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isPrimary: boolean;
}

export interface Customer {
  id: string;
  companyId: string;
  name: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToProvince: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  taxCodeId: string | null;
  paymentTermsDays: number;
  notes: string | null;
  isActive: boolean;
  openingBalanceCents: number;
  contacts: Contact[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Vendor {
  id: string;
  companyId: string;
  name: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  taxCodeId: string | null;
  paymentTermsDays: number;
  businessNumber: string | null;
  notes: string | null;
  isActive: boolean;
  openingBalanceCents: number;
  contacts: Contact[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceItem {
  id: string;
  companyId: string;
  type: string; // SERVICE | PRODUCT
  code: string;
  name: string;
  description: string | null;
  unitPriceCents: number;
  unit: string;
  discountPercentMicro: number;
  incomeAccountId: string | null;
  expenseAccountId: string | null;
  taxCodeId: string | null;
  purchaseTaxCodeId: string | null;
  isActive: boolean;
  trackInventory: boolean;
  quantityOnHandMilli: number;
  averageCostCents: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Shared shape of a computed document line (invoice/estimate/bill/credit note). */
export interface DocumentLine {
  lineNo: number;
  itemId: string | null;
  accountId: string;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  discountPercentMicro: number;
  netCents: number;
  taxCodeId: string | null;
  taxCents: number;
  totalCents: number;
  projectId?: string | null;
  isBillable?: boolean;
  customerId?: string | null;
}

export interface Invoice {
  id: string;
  companyId: string;
  customerId: string;
  number: string;
  issueDate: Date;
  dueDate: Date;
  status: string;
  memo: string | null;
  terms: string | null;
  poNumber: string | null;
  currency: string;
  billToName: string | null;
  billToLine1: string | null;
  billToLine2: string | null;
  billToCity: string | null;
  billToProvince: string | null;
  billToPostalCode: string | null;
  billToCountry: string | null;
  shipToName: string | null;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToProvince: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  taxInclusive: boolean;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  writtenOffCents: number;
  journalEntryId: string | null;
  estimateId: string | null;
  recurringId: string | null;
  projectId: string | null;
  createdById: string | null;
  postedAt: Date | null;
  sentAt: Date | null;
  voidedAt: Date | null;
  lines: DocumentLine[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Estimate {
  id: string;
  companyId: string;
  customerId: string;
  number: string;
  issueDate: Date;
  expiryDate: Date | null;
  status: string;
  memo: string | null;
  terms: string | null;
  taxInclusive: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  convertedInvoiceId: string | null;
  lines: DocumentLine[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Bill {
  id: string;
  companyId: string;
  vendorId: string;
  number: string;
  vendorInvoiceNo: string | null;
  issueDate: Date;
  dueDate: Date;
  status: string;
  approvalStatus: string;
  approvedById: string | null;
  approvedAt: Date | null;
  memo: string | null;
  taxInclusive: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  amountPaidCents: number;
  balanceCents: number;
  journalEntryId: string | null;
  recurringId: string | null;
  projectId: string | null;
  createdById: string | null;
  postedAt: Date | null;
  voidedAt: Date | null;
  lines: DocumentLine[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Expense {
  id: string;
  companyId: string;
  number: string;
  date: Date;
  vendorId: string | null;
  payeeName: string | null;
  paymentAccountId: string;
  paymentMethod: string;
  reference: string | null;
  memo: string | null;
  status: string;
  approvalStatus: string;
  approvedById: string | null;
  approvedAt: Date | null;
  taxInclusive: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  journalEntryId: string | null;
  bankTransactionId: string | null;
  createdById: string | null;
  postedAt: Date | null;
  lines: DocumentLine[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditNote {
  id: string;
  companyId: string;
  type: string; // CUSTOMER | VENDOR
  customerId: string | null;
  vendorId: string | null;
  number: string;
  issueDate: Date;
  status: string;
  reason: string | null;
  memo: string | null;
  taxInclusive: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  appliedCents: number;
  balanceCents: number;
  journalEntryId: string | null;
  postedAt: Date | null;
  lines: DocumentLine[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Payment {
  id: string;
  companyId: string;
  type: string; // RECEIPT | PAYMENT
  number: string;
  date: Date;
  customerId: string | null;
  vendorId: string | null;
  bankAccountId: string;
  method: string;
  reference: string | null;
  memo: string | null;
  amountCents: number;
  appliedCents: number;
  unappliedCents: number;
  status: string;
  journalEntryId: string | null;
  bankTransactionId: string | null;
  createdById: string | null;
  postedAt: Date | null;
  createdAt: Date;
}

export interface PaymentAllocation {
  id: string;
  companyId: string;
  paymentId: string | null;
  invoiceId: string | null;
  billId: string | null;
  creditNoteId: string | null;
  kind: string; // PAYMENT | CREDIT | WRITE_OFF
  amountCents: number;
  date: Date;
}

// ── Phase 4: tax engine + inventory ────────────────────────────────────────

export interface TaxComponent {
  id: string;
  name: string;
  kind: string; // GST | HST | PST | QST | RST
  rateMicro: number;
  isRecoverable: boolean;
  compoundOnPrevious: boolean;
  liabilityAccountId: string | null;
  recoverableAccountId: string | null;
  sortOrder: number;
}

export interface TaxCode {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description: string | null;
  jurisdiction: string;
  appliesToSales: boolean;
  appliesToPurchases: boolean;
  isZeroRated: boolean;
  isExempt: boolean;
  isDefaultSales: boolean;
  isDefaultPurchase: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  components: TaxComponent[];
  createdAt: Date;
}

export interface TaxPeriod {
  id: string;
  companyId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  frequency: string;
  status: string;
  filingReference: string | null;
  filedAt: Date | null;
  lockedAt: Date | null;
  netFiledCents: number | null;
  createdAt: Date;
}

export interface TaxEntry {
  id: string;
  companyId: string;
  date: Date;
  direction: string; // SALE | PURCHASE
  sourceType: string;
  sourceId: string;
  sourceNumber: string | null;
  lineId: string | null;
  taxCodeId: string;
  taxComponentId: string | null;
  jurisdiction: string;
  kind: string;
  rateMicro: number;
  taxableCents: number;
  taxCents: number;
  recoverableCents: number;
  journalEntryId: string | null;
  taxPeriodId: string | null;
  partyName: string | null;
  createdAt: Date;
}

export interface InventoryMovement {
  id: string;
  companyId: string;
  itemId: string;
  date: Date;
  type: string; // PURCHASE | SALE | ADJUSTMENT
  quantityMilli: number;
  unitCostCents: number;
  totalCostCents: number;
  quantityOnHandAfterMilli: number;
  averageCostAfterCents: number;
  sourceType: string;
  sourceId: string | null;
  sourceNumber: string | null;
  journalEntryId: string | null;
  memo: string | null;
  createdById: string | null;
  createdAt: Date;
}
