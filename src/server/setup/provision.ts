/**
 * Company provisioning (spec §4 Company Setup, §14 Fiscal periods).
 *
 * Creates the chart of accounts, effective-dated tax codes, fiscal periods and
 * tax periods that the posting engine requires before a company can record a
 * single transaction.
 */

import type { Tx } from "@/lib/db";
import { addDays, addMonths, fiscalYearRange, utcDate } from "@/lib/dates";
import { CYCLE_MONTHS, DEFAULT_PLAN_CODE, isValidCycle, type BillingCycle } from "@/lib/plans";
import { resolveAssignment } from "@/server/plans/catalogue";
import { provincialTaxCodeTemplates } from "@/server/tax/regional-rates";
import { DEFAULT_CURRENCY, normalizeCurrency } from "@/lib/currency";
import {
  BASE_TAX_CODES,
  CANADIAN_SERVICE_COA,
  type TaxCodeTemplate,
} from "./templates";

export interface ProvisionCompanyInput {
  name: string;
  legalName?: string;
  province: string;
  fiscalYearStartMonth?: number;
  businessNumber?: string;
  gstNumber?: string;
  qstNumber?: string;
  pstNumber?: string;
  /** ISO 4217. Omitted means CAD, which is also the column default. */
  baseCurrency?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  city?: string;
  postalCode?: string;
  industry?: string;
  firmId?: string;
  /** Fiscal years to open up front. */
  fiscalYears?: number[];
  taxFilingFrequency?: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  /** Plan code from the database catalogue; defaults to the standard trial plan. */
  plan?: string;
  /** Billing cycle to sell the plan on. Monthly unless stated. */
  billingCycle?: string;
  country?: string;
  addressLine2?: string;
  website?: string;
  /** Days of trial. 30 unless stated; 0 means the subscription starts active. */
  trialDays?: number;
}

/**
 * The company row plus everything the posting engine needs before a single
 * transaction can be recorded: chart of accounts, effective-dated tax codes,
 * fiscal periods and tax periods. No subscription — that is a separate concern
 * with two different callers (a fresh signup creates one; a Primary adding a
 * sibling company under their existing plan must not).
 */
async function createCompanyAndSetup(tx: Tx, input: ProvisionCompanyInput) {
  const fiscalYearStartMonth = input.fiscalYearStartMonth ?? 1;

  const company = await tx.company.create({
    data: {
      name: input.name,
      legalName: input.legalName ?? input.name,
      province: input.province,
      fiscalYearStartMonth,
      businessNumber: input.businessNumber,
      gstNumber: input.gstNumber,
      qstNumber: input.qstNumber,
      pstNumber: input.pstNumber,
      // An unrecognised code must not create a company that formats as garbage;
      // fall back to the default rather than storing whatever was passed.
      baseCurrency: normalizeCurrency(input.baseCurrency) ?? DEFAULT_CURRENCY,
      email: input.email,
      phone: input.phone,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      postalCode: input.postalCode,
      website: input.website,
      country: input.country ?? "CA",
      industry: input.industry,
      firmId: input.firmId,
    },
  });

  await createChartOfAccounts(tx, company.id);
  await createTaxCodes(tx, company.id, input.province);

  const currentYear = new Date().getUTCFullYear();
  const years = input.fiscalYears ?? [currentYear - 1, currentYear, currentYear + 1];
  for (const year of years) {
    await createFiscalYear(tx, company.id, year, fiscalYearStartMonth);
  }
  await createTaxPeriods(tx, company.id, years, input.taxFilingFrequency ?? "QUARTERLY");

  return company;
}

/**
 * Add a company under an EXISTING subscription — self-service, from a Primary
 * who already has a plan. Deliberately the same setup pipeline as a fresh
 * signup and deliberately no subscription of its own: the caller is
 * responsible for attaching the returned company to a subscription (see
 * src/server/companies/families.ts) inside the same transaction, after
 * confirming the plan's company limit under a row lock.
 */
export async function provisionAdditionalCompany(tx: Tx, input: ProvisionCompanyInput) {
  return createCompanyAndSetup(tx, input);
}

export async function provisionCompany(tx: Tx, input: ProvisionCompanyInput) {
  const cycle: BillingCycle = isValidCycle(input.billingCycle) ? input.billingCycle : "MONTHLY";

  // The plan, its seat allowance and its price all come from the published
  // catalogue — the same snapshot a self-serve customer would have been quoted.
  // A database with no published plans yet still provisions: the company is
  // created without a subscription rather than on invented terms.
  const assignment = await resolveAssignment(tx, input.plan ?? DEFAULT_PLAN_CODE, cycle);

  const company = await createCompanyAndSetup(tx, input);

  if (assignment) {
    const now = new Date();
    const trialDays = input.trialDays ?? 30;
    const trialing = trialDays > 0;

    await tx.subscription.create({
      data: {
        companyId: company.id,
        plan: assignment.planCode,
        planId: assignment.planId,
        // The price is frozen onto the row at the moment of sale. Editing the
        // plan's public price later must not rewrite what this client agreed to.
        planVersionId: assignment.planVersionId,
        billingCycle: assignment.billingCycle,
        currency: assignment.currency,
        priceCents: assignment.priceCents,
        monthlyEquivalentCents: assignment.monthlyEquivalentCents,
        seats: assignment.seats,
        status: trialing ? "TRIALING" : "ACTIVE",
        trialStartsAt: trialing ? now : null,
        trialEndsAt: trialing ? addDays(now, trialDays) : null,
        startedAt: trialing ? null : now,
        currentPeriodStart: trialing ? null : now,
        currentPeriodEnd: trialing ? null : addMonths(now, CYCLE_MONTHS[assignment.billingCycle]),
      },
    });
  }

  return company;
}

export async function createChartOfAccounts(tx: Tx, companyId: string) {
  await tx.account.createMany({
    data: CANADIAN_SERVICE_COA.map((a) => ({
      companyId,
      code: a.code,
      name: a.name,
      type: a.type,
      subtype: a.subtype,
      description: a.description ?? null,
      systemKey: a.systemKey ?? null,
      isSystem: Boolean(a.systemKey),
    })),
  });
  return tx.account.findMany({ where: { companyId }, orderBy: { code: "asc" } });
}

/** systemKey → account id, which is how tax components find their control accounts. */
async function systemAccountIds(tx: Tx, companyId: string) {
  const accounts = await tx.account.findMany({
    where: { companyId, systemKey: { not: null } },
    select: { id: true, systemKey: true },
  });
  return new Map(accounts.map((a) => [a.systemKey!, a.id]));
}

/**
 * Materialise one published rate template as a TaxCode with its components.
 *
 * Components wire to the GST/PST/QST control accounts by systemKey, so the
 * posting engine never has to guess where tax lands.
 */
export async function createTaxCodeFromTemplate(
  tx: Tx,
  companyId: string,
  template: TaxCodeTemplate,
  byKey: Map<string, string>,
  isDefault = false,
) {
  return tx.taxCode.create({
    data: {
      companyId,
      code: template.code,
      name: template.name,
      description: template.description,
      jurisdiction: template.jurisdiction,
      isZeroRated: template.isZeroRated ?? false,
      isExempt: template.isExempt ?? false,
      appliesToSales: template.appliesToSales ?? true,
      appliesToPurchases: template.appliesToPurchases ?? true,
      isDefaultSales: isDefault,
      isDefaultPurchase: isDefault,
      effectiveFrom: new Date(`${template.effectiveFrom}T00:00:00.000Z`),
      components: {
        create: template.components.map((c, order) => ({
          name: c.name,
          kind: c.kind,
          rateMicro: c.rateMicro,
          isRecoverable: c.isRecoverable,
          compoundOnPrevious: c.compoundOnPrevious ?? false,
          liabilityAccountId: c.liabilityKey ? (byKey.get(c.liabilityKey) ?? null) : null,
          recoverableAccountId: c.recoverableKey ? (byKey.get(c.recoverableKey) ?? null) : null,
          sortOrder: order,
        })),
      },
    },
    include: { components: true },
  });
}

export async function createTaxCodes(tx: Tx, companyId: string, province: string) {
  const byKey = await systemAccountIds(tx, companyId);
  // The provincial half comes from the platform's centrally-managed regional
  // rates (falls back to the static table if none is configured yet); the base
  // codes (GST-only, zero-rated, exempt, out of scope) are unchanged.
  const provincial = await provincialTaxCodeTemplates(province);
  const templates = [...provincial, ...BASE_TAX_CODES];
  const created = [];
  for (const [index, template] of templates.entries()) {
    // The company's own province leads the list, and is what a new document
    // defaults to.
    created.push(await createTaxCodeFromTemplate(tx, companyId, template, byKey, index === 0));
  }
  return created;
}

/**
 * Add the published codes for a province the company does not yet have one for.
 *
 * Selling into another province means charging that province's rate, and a
 * company only gets its own province's codes at provisioning. Never marked
 * default — the home province keeps that. Codes that already exist are skipped,
 * so this is safe to call twice, and it never edits an existing rate (§7).
 */
export async function createProvincialTaxCodes(tx: Tx, companyId: string, province: string) {
  const templates = await provincialTaxCodeTemplates(province);
  if (templates.length === 0) return [];

  const existing = await tx.taxCode.findMany({
    where: { companyId, code: { in: templates.map((t) => t.code) } },
    select: { code: true },
  });
  const have = new Set(existing.map((c) => c.code));
  const missing = templates.filter((t) => !have.has(t.code));
  if (missing.length === 0) return [];

  const byKey = await systemAccountIds(tx, companyId);
  const created = [];
  for (const template of missing) {
    created.push(await createTaxCodeFromTemplate(tx, companyId, template, byKey, false));
  }
  return created;
}

/** Twelve monthly periods for one fiscal year (§14). */
export async function createFiscalYear(
  tx: Tx,
  companyId: string,
  fiscalYear: number,
  fiscalYearStartMonth: number,
) {
  const existing = await tx.fiscalPeriod.count({ where: { companyId, fiscalYear } });
  if (existing > 0) return;

  const { start } = fiscalYearRange(fiscalYear, fiscalYearStartMonth);
  const data = [];
  for (let i = 0; i < 12; i++) {
    const periodStart = addMonths(start, i);
    const periodEnd = addDays(addMonths(periodStart, 1), -1);
    data.push({
      companyId,
      fiscalYear,
      periodNumber: i + 1,
      name: new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(periodStart),
      startDate: periodStart,
      endDate: periodEnd,
      status: "OPEN",
    });
  }
  await tx.fiscalPeriod.createMany({ data });
}

export async function createTaxPeriods(
  tx: Tx,
  companyId: string,
  years: number[],
  frequency: "MONTHLY" | "QUARTERLY" | "ANNUAL",
) {
  const monthsPerPeriod = frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;
  const data = [];
  for (const year of years) {
    for (let i = 0; i < 12 / monthsPerPeriod; i++) {
      const startDate = utcDate(year, i * monthsPerPeriod + 1, 1);
      const endDate = addDays(addMonths(startDate, monthsPerPeriod), -1);
      const label =
        frequency === "QUARTERLY"
          ? `Q${i + 1} ${year}`
          : frequency === "ANNUAL"
            ? `${year}`
            : new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" }).format(startDate);
      data.push({
        companyId,
        name: `GST/HST ${label}`,
        startDate,
        endDate,
        frequency,
        status: "OPEN",
      });
    }
  }
  await tx.taxPeriod.createMany({ data });
}
