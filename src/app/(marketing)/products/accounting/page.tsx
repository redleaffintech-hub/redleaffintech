import { Icon } from "@/components/shell/icons";
import {
  CheckList,
  Container,
  Cta,
  CtaBand,
  Eyebrow,
  Section,
  SectionHeading,
} from "@/components/marketing/ui";

export const metadata = {
  title: "Red Leaf Accounting",
  description:
    "Red Leaf Accounting — Canadian double-entry accounting with general ledger, A/R, A/P, invoicing, expenses, bank reconciliation, an effective-dated GST/HST/PST/QST engine, financial statements and period close.",
};

const CAPABILITY_GROUPS = [
  {
    icon: "receipt",
    title: "Sales and receivables",
    items: [
      "Sales quotes that convert to invoices",
      "Invoices with per-line tax treatment",
      "Credit notes and customer refunds",
      "Receipts and payment allocation",
      "A/R aging that reconciles to the control account",
      "Customer records, contacts and statements",
    ],
  },
  {
    icon: "truck",
    title: "Purchases and payables",
    items: [
      "Vendor bills with approval workflow",
      "Bill payments and partial allocation",
      "Vendor records and contacts",
      "A/P aging tied to the ledger",
      "Recurring bills and templates",
      "Expense claims with attachments",
    ],
  },
  {
    icon: "bank",
    title: "Banking",
    items: [
      "Statement import and a review queue",
      "Rules that categorise as lines arrive",
      "Automatic matching against documents",
      "Reconciliations that must reach zero",
      "Multiple bank and credit card accounts",
      "Cleared-versus-book balance at any date",
    ],
  },
  {
    icon: "percent",
    title: "Tax",
    items: [
      "GST, HST, PST, RST and QST",
      "Effective-dated rates — never hard-coded",
      "Compound tax (QST on GST) handled exactly",
      "Recoverable versus expensed input tax",
      "Filing periods with a return working paper",
      "A tax subledger that ties to the control accounts",
    ],
  },
  {
    icon: "chart",
    title: "Reporting",
    items: [
      "Balance sheet and profit and loss",
      "Cash flow that ties to cash movement",
      "Trial balance and general ledger detail",
      "Budget versus actual",
      "A/R and A/P aging",
      "Tax summary and tax detail",
    ],
  },
  {
    icon: "lock",
    title: "Control and close",
    items: [
      "Fiscal periods you can open, close and lock",
      "Posted entries reversed, never edited",
      "Immutable audit trail of every change",
      "Role-based access enforced server-side",
      "Read-only client files for review",
      "Document numbering per company",
    ],
  },
];

export default function AccountingPage() {
  return (
    <>
      <div className="relative overflow-hidden border-b border-paper-300 bg-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage: "radial-gradient(ellipse 55% 60% at 92% 0%, #eaf4fb 0, transparent 70%)",
          }}
        />
        <Container className="relative py-14 sm:py-20">
          <Eyebrow>Products / Accounting</Eyebrow>
          <h1 className="font-display mt-3 max-w-3xl text-[2.125rem] font-semibold leading-[1.12] tracking-[-0.03em] text-ink-950 sm:text-[2.75rem]">
            Red Leaf Accounting
          </h1>
          <p className="mt-5 max-w-2xl text-[1.0625rem] leading-8 text-muted-ink">
            Canadian double-entry accounting where the ledger is the product, not a by-product. Every document
            posts a balanced journal entry, every report drills back to it, and the tax engine knows what
            province you are in.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Cta href="/pricing" size="lg">
              Choose a plan
              <Icon name="chevron" className="h-4 w-4" />
            </Cta>
            <Cta href="/contact?topic=demo" variant="secondary" size="lg">
              Request a walkthrough
            </Cta>
          </div>
        </Container>
      </div>

      <Section tone="canvas">
        <SectionHeading
          eyebrow="What is included"
          title="The whole accounting cycle, in one system"
          description="Nothing here is an add-on or a higher tier: every plan carries the full ledger and the full tax engine."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITY_GROUPS.map((group) => (
            <div key={group.title} className="rounded-(--radius-card) border border-paper-300 bg-white p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand-700">
                  <Icon name={group.icon} className="h-[1.15rem] w-[1.15rem]" />
                </span>
                <h3 className="text-[0.9375rem] font-semibold text-ink-900">{group.title}</h3>
              </div>
              <ul className="mt-4 grid gap-2">
                {group.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-positive" />
                    <span className="text-[0.8125rem] leading-6 text-ink-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="white">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionHeading
              eyebrow="What makes it different"
              title="Rigour you can check, not just claim"
            />
            <div className="mt-7">
              <CheckList
                items={[
                  "Money is stored as integer cents — never a floating-point amount",
                  "Tax rates are stored to six decimal places, so 9.975% QST is exact",
                  "A reconciliation cannot be finished while a difference remains",
                  "A posted journal entry is reversed, never silently edited or deleted",
                  "Assets always equal liabilities plus equity — the app checks continuously",
                  "Every report figure links through to the entries behind it",
                ]}
              />
            </div>
          </div>

          <div className="rounded-(--radius-card) border border-paper-300 bg-paper-100 p-7">
            <h3 className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-500">
              Set up for your province
            </h3>
            <p className="mt-4 text-[0.9375rem] leading-7 text-muted-ink">
              When a company is created, Red Leaf provisions a Canadian chart of accounts, the tax codes that
              apply where you are registered, and open fiscal and filing periods. You can start invoicing
              immediately instead of spending a week building a ledger.
            </p>
            <dl className="mt-6 grid gap-3 border-t border-paper-300 pt-5 text-[0.875rem]">
              {[
                { k: "Chart of accounts", v: "Canadian service-business template, editable" },
                { k: "Tax codes", v: "GST/HST/PST/QST for your province, effective-dated" },
                { k: "Fiscal periods", v: "Prior, current and next year opened" },
                { k: "Filing periods", v: "Monthly, quarterly or annual" },
                { k: "Currency", v: "CAD, with tabular figures throughout" },
              ].map((row) => (
                <div key={row.k} className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-ink">{row.k}</dt>
                  <dd className="text-right font-medium text-ink-900">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      <CtaBand
        title="Ready to see it on your own numbers?"
        description="Pick a plan and your environment is provisioned in minutes, or ask us for a walkthrough first."
        primary={{ href: "/pricing", label: "Choose a plan" }}
        secondary={{ href: "/contact?topic=demo", label: "Request a walkthrough" }}
      />
    </>
  );
}
