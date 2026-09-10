/**
 * Company provisioning (§4 Company Setup, §14 Fiscal periods).
 *
 * Creates the chart of accounts, effective-dated tax codes, fiscal periods and
 * tax periods that the posting engine requires before a company can record a
 * single transaction.
 *
 * Firestore has no cross-collection "one transaction" for ~90 independent
 * creates, so setup is written with a `BulkWriter` after the company doc exists.
 * If it fails partway the company is incompletely set up — the caller should
 * treat provisioning as all-or-nothing at its own level (delete on failure).
 */

import "server-only";

import { addDays, addMonths, fiscalYearRange, utcDate } from "@/lib/dates";
import { CYCLE_MONTHS, DEFAULT_PLAN_CODE, isValidCycle, type BillingCycle } from "@/lib/plans";
import { DEFAULT_CURRENCY, normalizeCurrency } from "@/lib/currency";
import { resolveAssignment } from "@/server/plans/catalogue";
import { provincialTaxCodeTemplates } from "@/server/tax/regional-rates";
import { defaultLeaveTypeRows } from "@/server/hr/leave";
import { companyRef, db, newId, sub, toTimestamp } from "@/server/db/firestore";
import { subscriptions } from "@/server/db/platform";
import { BASE_TAX_CODES, CANADIAN_SERVICE_COA, type TaxCodeTemplate } from "./templates";

export interface ProvisionCompanyInput {
  name: string;
  legalName?: string;
  province: string;
  fiscalYearStartMonth?: number;
  businessNumber?: string;
  gstNumber?: string;
  qstNumber?: string;
  pstNumber?: string;
  baseCurrency?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  city?: string;
  postalCode?: string;
  industry?: string;
  firmId?: string;
  fiscalYears?: number[];
  taxFilingFrequency?: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  plan?: string;
  billingCycle?: string;
  country?: string;
  addressLine2?: string;
  website?: string;
  trialDays?: number;
  enabledModules?: string[];
}

const COMPANY_DEFAULTS = {
  invoicePrefix: "INV-",
  nextInvoiceNumber: 1001,
  estimatePrefix: "EST-",
  nextEstimateNumber: 1001,
  billPrefix: "BILL-",
  nextBillNumber: 1001,
  creditPrefix: "CN-",
  nextCreditNumber: 1001,
  paymentPrefix: "PMT-",
  nextPaymentNumber: 1001,
  journalPrefix: "JE-",
  nextJournalNumber: 1,
  expensePrefix: "EXP-",
  nextExpenseNumber: 1001,
  employeePrefix: "EMP-",
  nextEmployeeNumber: 1001,
  payRunPrefix: "PR-",
  nextPayRunNumber: 1001,
  defaultPaymentTermsDays: 15,
  defaultTaxInclusive: false,
  invoiceFooter: null,
  locale: "en-CA",
};

interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string;
  description: string | null;
  systemKey: string | null;
  isSystem: boolean;
}

function chartRows(): AccountRow[] {
  return CANADIAN_SERVICE_COA.map((a) => ({
    id: newId(),
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    description: a.description ?? null,
    systemKey: a.systemKey ?? null,
    isSystem: Boolean(a.systemKey),
  }));
}

function taxCodeDocs(
  templates: { template: TaxCodeTemplate; isDefault: boolean }[],
  byKey: Map<string, string>,
) {
  return templates.map(({ template, isDefault }) => ({
    id: newId(),
    code: template.code,
    name: template.name,
    description: template.description ?? null,
    jurisdiction: template.jurisdiction,
    isZeroRated: template.isZeroRated ?? false,
    isExempt: template.isExempt ?? false,
    appliesToSales: template.appliesToSales ?? true,
    appliesToPurchases: template.appliesToPurchases ?? true,
    isDefaultSales: isDefault,
    isDefaultPurchase: isDefault,
    isActive: true,
    effectiveFrom: new Date(`${template.effectiveFrom}T00:00:00.000Z`),
    effectiveTo: null,
    components: template.components.map((c, order) => ({
      id: newId(),
      name: c.name,
      kind: c.kind,
      rateMicro: c.rateMicro,
      isRecoverable: c.isRecoverable,
      compoundOnPrevious: c.compoundOnPrevious ?? false,
      liabilityAccountId: c.liabilityKey ? (byKey.get(c.liabilityKey) ?? null) : null,
      recoverableAccountId: c.recoverableKey ? (byKey.get(c.recoverableKey) ?? null) : null,
      sortOrder: order,
    })),
  }));
}

function fiscalPeriodDocs(years: number[], fiscalYearStartMonth: number) {
  const fmt = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
  const rows: { id: string; fiscalYear: number; periodNumber: number; name: string; startDate: Date; endDate: Date }[] = [];
  for (const year of years) {
    const { start } = fiscalYearRange(year, fiscalYearStartMonth);
    for (let i = 0; i < 12; i++) {
      const startDate = addMonths(start, i);
      rows.push({
        id: `${year}-${String(i + 1).padStart(2, "0")}`,
        fiscalYear: year,
        periodNumber: i + 1,
        name: fmt.format(startDate),
        startDate,
        endDate: addDays(addMonths(startDate, 1), -1),
      });
    }
  }
  return rows;
}

function taxPeriodDocs(years: number[], frequency: "MONTHLY" | "QUARTERLY" | "ANNUAL") {
  const monthsPer = frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;
  const shortFmt = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
  const rows: { id: string; name: string; startDate: Date; endDate: Date; frequency: string }[] = [];
  for (const year of years) {
    for (let i = 0; i < 12 / monthsPer; i++) {
      const startDate = utcDate(year, i * monthsPer + 1, 1);
      const label =
        frequency === "QUARTERLY"
          ? `Q${i + 1} ${year}`
          : frequency === "ANNUAL"
            ? `${year}`
            : shortFmt.format(startDate);
      rows.push({
        id: newId(),
        name: `GST/HST ${label}`,
        startDate,
        endDate: addDays(addMonths(startDate, monthsPer), -1),
        frequency,
      });
    }
  }
  return rows;
}

async function createCompanyAndSetup(
  input: ProvisionCompanyInput,
): Promise<{ id: string; name: string }> {
  const fiscalYearStartMonth = input.fiscalYearStartMonth ?? 1;
  const companyId = newId();
  const now = new Date();

  await companyRef(companyId).set({
    name: input.name,
    legalName: input.legalName ?? input.name,
    businessNumber: input.businessNumber ?? null,
    gstNumber: input.gstNumber ?? null,
    qstNumber: input.qstNumber ?? null,
    pstNumber: input.pstNumber ?? null,
    province: input.province,
    country: input.country ?? "CA",
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    city: input.city ?? null,
    postalCode: input.postalCode ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    baseCurrency: normalizeCurrency(input.baseCurrency) ?? DEFAULT_CURRENCY,
    fiscalYearStartMonth,
    industry: input.industry ?? null,
    logoUrl: null,
    firmId: input.firmId ?? null,
    isReadOnly: false,
    archivedAt: null,
    archivedById: null,
    archiveReason: null,
    enabledModules: input.enabledModules?.length ? input.enabledModules : ["ACCOUNTING"],
    ...COMPANY_DEFAULTS,
    createdAt: toTimestamp(now),
    updatedAt: toTimestamp(now),
  });

  const accounts = chartRows();
  const byKey = new Map(accounts.filter((a) => a.systemKey).map((a) => [a.systemKey!, a.id]));

  const provincial = await provincialTaxCodeTemplates(input.province);
  const templates = [
    ...provincial.map((template, i) => ({ template, isDefault: i === 0 })),
    ...BASE_TAX_CODES.map((template) => ({ template, isDefault: false })),
  ];
  const taxCodes = taxCodeDocs(templates, byKey);

  const currentYear = new Date().getUTCFullYear();
  const years = input.fiscalYears ?? [currentYear - 1, currentYear, currentYear + 1];
  const periods = fiscalPeriodDocs(years, fiscalYearStartMonth);
  const taxPeriods = taxPeriodDocs(years, input.taxFilingFrequency ?? "QUARTERLY");
  const leaveRows = defaultLeaveTypeRows(companyId);

  const w = db.bulkWriter();
  for (const a of accounts) {
    w.set(sub(companyId, "accounts").doc(a.id), {
      companyId,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      parentId: null,
      description: a.description,
      isActive: true,
      isSystem: a.isSystem,
      systemKey: a.systemKey,
      currency: "CAD",
      createdAt: toTimestamp(now),
      updatedAt: toTimestamp(now),
    });
    if (a.systemKey) {
      // (guard doc for [companyId, code] uniqueness — created by createAccount
      // normally; provisioning writes them directly)
    }
    w.set(companyRef(companyId).collection("accountCodes").doc(a.code), { accountId: a.id });
  }
  for (const t of taxCodes) {
    w.set(sub(companyId, "taxCodes").doc(t.id), {
      companyId,
      code: t.code,
      name: t.name,
      description: t.description,
      jurisdiction: t.jurisdiction,
      appliesToSales: t.appliesToSales,
      appliesToPurchases: t.appliesToPurchases,
      isZeroRated: t.isZeroRated,
      isExempt: t.isExempt,
      isDefaultSales: t.isDefaultSales,
      isDefaultPurchase: t.isDefaultPurchase,
      isActive: t.isActive,
      effectiveFrom: toTimestamp(t.effectiveFrom),
      effectiveTo: null,
      components: t.components,
      createdAt: toTimestamp(now),
    });
    w.set(companyRef(companyId).collection("taxCodeCodes").doc(t.code), { taxCodeId: t.id });
  }
  for (const p of periods) {
    w.set(sub(companyId, "fiscalPeriods").doc(p.id), {
      companyId,
      fiscalYear: p.fiscalYear,
      periodNumber: p.periodNumber,
      name: p.name,
      startDate: toTimestamp(p.startDate),
      endDate: toTimestamp(p.endDate),
      status: "OPEN",
      closedAt: null,
      closedById: null,
      reopenedAt: null,
      notes: null,
    });
  }
  for (const tp of taxPeriods) {
    w.set(sub(companyId, "taxPeriods").doc(tp.id), {
      companyId,
      name: tp.name,
      startDate: toTimestamp(tp.startDate),
      endDate: toTimestamp(tp.endDate),
      frequency: tp.frequency,
      status: "OPEN",
      filingReference: null,
      filedAt: null,
      lockedAt: null,
      netFiledCents: null,
      createdAt: toTimestamp(now),
    });
  }
  for (const l of leaveRows) {
    w.set(sub(companyId, "leaveTypes").doc(l.id), {
      companyId,
      name: l.name,
      category: l.category,
      isPaid: l.isPaid,
      trackBalance: l.trackBalance,
      isActive: true,
      createdAt: toTimestamp(now),
    });
  }
  await w.close();

  return { id: companyId, name: input.name };
}

/**
 * NOTE: the leading `_legacyTx` parameter is ignored. Callers still inside a
 * Prisma `db.$transaction` pass it; it goes away when those call sites are
 * rewired (Phase 6c/6d). Firestore writes here are NOT part of any passed
 * transaction.
 */
export async function provisionAdditionalCompany(
  _legacyTx: unknown,
  input?: ProvisionCompanyInput,
) {
  return createCompanyAndSetup(input ?? (_legacyTx as ProvisionCompanyInput));
}

/**
 * Add the published tax codes for a province the company does not yet have one
 * for — selling into another province means charging that province's rate.
 * Never marked default; existing codes are skipped; never edits an existing
 * rate (§7).
 */
export async function createProvincialTaxCodes(
  companyId: string,
  province: string,
): Promise<{ id: string; code: string }[]> {
  const templates = await provincialTaxCodeTemplates(province);
  if (templates.length === 0) return [];

  const existing = await sub(companyId, "taxCodes").get();
  const have = new Set(existing.docs.map((d) => d.data().code as string));
  const missing = templates.filter((t) => !have.has(t.code));
  if (missing.length === 0) return [];

  const accountsSnap = await sub(companyId, "accounts").where("systemKey", "!=", null).get();
  const byKey = new Map(
    accountsSnap.docs.map((d) => [d.data().systemKey as string, d.id]),
  );
  const docs = taxCodeDocs(
    missing.map((template) => ({ template, isDefault: false })),
    byKey,
  );

  const now = new Date();
  const w = db.bulkWriter();
  for (const t of docs) {
    w.set(sub(companyId, "taxCodes").doc(t.id), {
      companyId,
      code: t.code,
      name: t.name,
      description: t.description,
      jurisdiction: t.jurisdiction,
      appliesToSales: t.appliesToSales,
      appliesToPurchases: t.appliesToPurchases,
      isZeroRated: t.isZeroRated,
      isExempt: t.isExempt,
      isDefaultSales: false,
      isDefaultPurchase: false,
      isActive: true,
      effectiveFrom: toTimestamp(t.effectiveFrom),
      effectiveTo: null,
      components: t.components,
      createdAt: toTimestamp(now),
    });
    w.set(companyRef(companyId).collection("taxCodeCodes").doc(t.code), { taxCodeId: t.id });
  }
  await w.close();
  return docs.map((t) => ({ id: t.id, code: t.code }));
}

export async function provisionCompany(
  _legacyTxOrInput: unknown,
  maybeInput?: ProvisionCompanyInput,
) {
  const input = (maybeInput ?? (_legacyTxOrInput as ProvisionCompanyInput));
  const cycle: BillingCycle = isValidCycle(input.billingCycle) ? input.billingCycle : "MONTHLY";
  const assignment = await resolveAssignment(input.plan ?? DEFAULT_PLAN_CODE, cycle);

  const company = await createCompanyAndSetup(input);

  if (assignment) {
    const now = new Date();
    const trialDays = input.trialDays ?? 30;
    const trialing = trialDays > 0;
    await subscriptions.create({
      id: newId(),
      companyId: company.id,
      plan: assignment.planCode,
      planId: assignment.planId,
      planVersionId: assignment.planVersionId,
      billingCycle: assignment.billingCycle,
      currency: assignment.currency,
      priceCents: assignment.priceCents,
      monthlyEquivalentCents: assignment.monthlyEquivalentCents,
      seats: assignment.seats,
      seatsOverridden: false,
      status: trialing ? "TRIALING" : "ACTIVE",
      trialStartsAt: trialing ? now : null,
      trialEndsAt: trialing ? addDays(now, trialDays) : null,
      startedAt: trialing ? null : now,
      currentPeriodStart: trialing ? null : now,
      currentPeriodEnd: trialing ? null : addMonths(now, CYCLE_MONTHS[assignment.billingCycle]),
    });
  }

  return company;
}
