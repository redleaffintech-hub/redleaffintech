import { db } from "@/lib/db";
import { requireVisible } from "@/server/auth/context";
import { CAPABILITIES, can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { DEFAULT_CURRENCY, currencyLabel, currencyOptions } from "@/lib/currency";
import { PROVINCES } from "@/lib/enums";
import { Badge, Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui";
import { CompanyProfileForm, NumberingForm } from "./company-form";

export const metadata = { title: "Company profile" };

export default async function CompanyPage() {
  const { company, role } = await requireVisible(CAPABILITIES.COMPANY_SETTINGS);
  const editable = can(role, CAPABILITIES.COMPANY_SETTINGS);

  const record = await db.company.findUniqueOrThrow({ where: { id: company.id } });
  const [postedEntries, accounts, users] = await Promise.all([
    db.journalEntry.count({ where: { companyId: company.id } }),
    db.account.count({ where: { companyId: company.id, isActive: true } }),
    db.companyUser.count({ where: { companyId: company.id, status: "ACTIVE" } }),
  ]);

  const provinceName = PROVINCES.find((p) => p.code === record.province)?.name ?? record.province;

  return (
    <>
      <PageHeader
        title="Company profile"
        breadcrumb={[{ label: "Company" }, { label: "Profile & preferences" }]}
        description="What appears on documents, and the defaults every new invoice, bill and expense starts from."
        actions={record.isReadOnly ? <Badge tone="caution">read-only file</Badge> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-4">
          {editable ? (
            <CompanyProfileForm
              company={{
                name: record.name,
                legalName: record.legalName ?? "",
                businessNumber: record.businessNumber ?? "",
                gstNumber: record.gstNumber ?? "",
                qstNumber: record.qstNumber ?? "",
                pstNumber: record.pstNumber ?? "",
                baseCurrency: record.baseCurrency || DEFAULT_CURRENCY,
                province: record.province,
                addressLine1: record.addressLine1 ?? "",
                city: record.city ?? "",
                postalCode: record.postalCode ?? "",
                phone: record.phone ?? "",
                email: record.email ?? "",
                website: record.website ?? "",
                fiscalYearStartMonth: record.fiscalYearStartMonth,
                defaultPaymentTermsDays: record.defaultPaymentTermsDays,
                defaultTaxInclusive: record.defaultTaxInclusive,
                invoiceFooter: record.invoiceFooter ?? "",
              }}
              currencies={currencyOptions(record.baseCurrency)}
              fiscalYearLocked={postedEntries > 0}
              postedEntries={postedEntries}
            />
          ) : (
            <Card className="p-5">
              <CardHeader title="Details" subtitle="Your role can view these settings but not change them" />
              <DefinitionList
                items={[
                  { label: "Operating name", value: record.name },
                  { label: "Legal name", value: record.legalName ?? "—" },
                  { label: "Province", value: provinceName },
                  { label: "Business number", value: record.businessNumber ?? "—" },
                  { label: "GST/HST number", value: record.gstNumber ?? "—" },
                  { label: "QST number", value: record.qstNumber ?? "—" },
                  { label: "PST number", value: record.pstNumber ?? "—" },
                  { label: "Base currency", value: currencyLabel(record.baseCurrency || DEFAULT_CURRENCY) },
                  { label: "Address", value: [record.addressLine1, record.city, record.postalCode].filter(Boolean).join(", ") || "—" },
                  { label: "Email", value: record.email ?? "—" },
                  { label: "Phone", value: record.phone ?? "—" },
                ]}
              />
            </Card>
          )}

          {editable && (
            <NumberingForm
              numbering={{
                invoicePrefix: record.invoicePrefix,
                estimatePrefix: record.estimatePrefix,
                billPrefix: record.billPrefix,
                creditPrefix: record.creditPrefix,
                paymentPrefix: record.paymentPrefix,
                expensePrefix: record.expensePrefix,
                journalPrefix: record.journalPrefix,
              }}
              next={{
                invoice: record.nextInvoiceNumber,
                estimate: record.nextEstimateNumber,
                bill: record.nextBillNumber,
                credit: record.nextCreditNumber,
                payment: record.nextPaymentNumber,
                expense: record.nextExpenseNumber,
                journal: record.nextJournalNumber,
              }}
            />
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="This file" />
            <dl className="mt-3 space-y-2.5 text-[0.8125rem]">
              <Row label="Jurisdiction" value={`${provinceName} · ${record.country}`} />
              <Row label="Base currency" value={currencyLabel(record.baseCurrency || DEFAULT_CURRENCY)} />
              <Row
                label="Fiscal year starts"
                value={new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(
                  new Date(Date.UTC(2000, record.fiscalYearStartMonth - 1, 1)),
                )}
              />
              <Row label="Accounts" value={String(accounts)} />
              <Row label="Posted entries" value={postedEntries.toLocaleString("en-CA")} />
              <Row label="People with access" value={String(users)} />
              <Row label="Opened" value={formatDate(record.createdAt)} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Currency" />
            <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">
              This file keeps its books in {currencyLabel(record.baseCurrency || DEFAULT_CURRENCY)}, set under
              Details. It is a display and reporting setting: amounts are stored as plain numbers, so changing it
              relabels what every figure is presented as and converts nothing.
              {postedEntries > 0 && " With entries already posted, the change asks for confirmation first."}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="tnum text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
