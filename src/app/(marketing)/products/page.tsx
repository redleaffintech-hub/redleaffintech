import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { MODULE_CATALOG } from "@/lib/plans";
import { Cta, CtaBand, PageHero, Section, SectionHeading } from "@/components/marketing/ui";

export const metadata = {
  title: "Products",
  description:
    "The Red Leaf Fintech product shelf: Red Leaf Accounting is available now, with Payroll, HR, Tax, Payments, Banking and Inventory to follow on the same platform.",
};

export default function ProductsPage() {
  const [live, ...upcoming] = MODULE_CATALOG;

  return (
    <>
      <PageHero
        eyebrow="Products"
        title="One platform, one login, a product for each part of the back office"
        description="Every Red Leaf product shares the same users, companies, roles and subscription. Turn one on and it appears in the same workspace your team already knows."
      />

      {/* Live product */}
      <Section tone="canvas">
        <div className="rounded-(--radius-card) border border-brand-200 bg-white p-7 shadow-[0_2px_4px_rgba(47,109,156,0.08),0_20px_44px_-28px_rgba(47,109,156,0.35)] sm:p-10">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand-700">
              <Icon name={live.icon} className="h-6 w-6" />
            </span>
            <div>
              <span className="rounded-full bg-positive-soft px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-positive">
                Available now
              </span>
              <h2 className="font-display mt-1.5 text-[1.5rem] font-semibold tracking-[-0.02em] text-ink-950">
                {live.name}
              </h2>
            </div>
          </div>

          <p className="mt-6 max-w-3xl text-[1rem] leading-8 text-muted-ink">
            A complete Canadian accounting system built on a real double-entry ledger. It covers the whole
            cycle — quote to invoice to payment, bill to approval to payment, bank import to reconciliation to
            period close — and every number on every statement drills back to the journal entry behind it.
          </p>

          <div className="mt-8 grid gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              "General ledger",
              "Accounts receivable",
              "Accounts payable",
              "Invoicing and sales quotes",
              "Expense management",
              "Bank reconciliation",
              "Chart of accounts",
              "Journal entries",
              "Customer management",
              "Vendor management",
              "Financial statements",
              "Tax reporting (GST/HST/PST/QST)",
              "Budgets and budget vs actual",
              "Period close and year-end",
              "Bank import and rules",
              "Audit trail",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <Icon name="check" className="h-4 w-4 shrink-0 text-positive" />
                <span className="text-[0.875rem] text-ink-700">{item}</span>
              </div>
            ))}
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <Cta href="/products/accounting">
              Explore Red Leaf Accounting
              <Icon name="chevron" className="h-4 w-4" />
            </Cta>
            <Cta href="/pricing" variant="secondary">
              See pricing
            </Cta>
          </div>
        </div>
      </Section>

      {/* Roadmap */}
      <Section tone="white">
        <SectionHeading
          eyebrow="On the roadmap"
          title="Six more products, already accounted for"
          description="These are not vague ambitions — the user, company, role and subscription layers were built to carry them, so each arrives as a switch rather than a migration."
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.map((module) => (
            <div key={module.id} className="rounded-(--radius-card) border border-paper-300 bg-paper-100 p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-paper-300 text-ink-500">
                  <Icon name={module.icon} className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-[0.9375rem] font-semibold text-ink-800">{module.name}</h3>
                  <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-500">
                    Coming soon
                  </p>
                </div>
              </div>
              <p className="mt-4 text-[0.875rem] leading-6 text-muted-ink">{module.blurb}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-[0.875rem] text-muted-ink">
          Want to be told when one of these ships?{" "}
          <Link href="/contact?topic=roadmap" className="font-medium text-brand-700 hover:underline">
            Let us know which module matters to you
          </Link>
          .
        </p>
      </Section>

      <CtaBand
        title="Start with the product that is ready today"
        description="Red Leaf Accounting is live, provisioned for your province, and priced from four plans."
        primary={{ href: "/pricing", label: "Choose a plan" }}
        secondary={{ href: "/solutions", label: "See it by use case" }}
      />
    </>
  );
}
