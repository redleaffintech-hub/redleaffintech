import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { MODULE_CATALOG } from "@/lib/plans";
import {
  CheckList,
  Container,
  Cta,
  CtaBand,
  Eyebrow,
  FeatureCard,
  Section,
  SectionHeading,
  Stat,
} from "@/components/marketing/ui";

export const metadata = {
  // `absolute` so the root layout's "%s · Red Leaf Fintech" template does not
  // append the brand a second time on the home page.
  title: { absolute: "Red Leaf Fintech — run your whole business on one platform" },
  description:
    "A complete business management platform for Canadian companies. Accounting is live today, with payroll, HR, tax, payments, banking and inventory built on the same ledger, users and permissions.",
};

const ACCOUNTING_FEATURES = [
  { icon: "ledger", title: "General ledger", body: "A real double-entry ledger. Every document posts a balanced journal entry, and every report drills back to it." },
  { icon: "receipt", title: "Invoicing & A/R", body: "Sales quotes, invoices, credit notes, receipts and customer statements, with aging that reconciles to the control account." },
  { icon: "truck", title: "Bills & A/P", body: "Vendor bills, approvals, payments and A/P aging — matched against the ledger, not a spreadsheet." },
  { icon: "wallet", title: "Expenses", body: "Capture expenses with tax treatment applied line by line and attachments kept with the entry." },
  { icon: "bank", title: "Banking & reconciliation", body: "Import statements, auto-match with rules, and finish a reconciliation only when the difference is zero." },
  { icon: "percent", title: "GST/HST, PST, QST", body: "An effective-dated tax engine — rates are data, never hard-coded, and returns tie to a subledger." },
  { icon: "chart", title: "Financial statements", body: "Balance sheet, profit and loss, cash flow, trial balance, budget vs actual and aging, all traceable." },
  { icon: "lock", title: "Period close & audit", body: "Close a period, lock the past, and keep an immutable audit trail of who changed what." },
];

export default function HomePage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-b border-paper-300 bg-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "radial-gradient(ellipse 60% 55% at 85% 0%, #eaf4fb 0, transparent 70%), radial-gradient(ellipse 45% 45% at 5% 10%, #fcecec 0, transparent 70%)",
          }}
        />
        <Container className="relative grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Eyebrow>Business management platform</Eyebrow>
            <h1 className="font-display mt-4 text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink-950 sm:text-[3.25rem]">
              Run the whole business
              <br />
              on <span className="text-maple-500">one</span> platform.
            </h1>
            <p className="mt-6 max-w-xl text-[1.0625rem] leading-8 text-muted-ink">
              Red Leaf Fintech brings accounting, payroll, HR, tax, payments, banking and inventory together
              for Canadian businesses. Accounting is live today — everything that follows is built on the same
              ledger, the same users and the same permissions.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Cta href="/pricing" size="lg">
                Get started
                <Icon name="chevron" className="h-4 w-4" />
              </Cta>
              <Cta href="/products/accounting" variant="secondary" size="lg">
                See Red Leaf Accounting
              </Cta>
            </div>

            <p className="mt-5 text-[0.8125rem] text-muted-ink">
              Already a customer?{" "}
              <Link href="/login" className="font-medium text-brand-700 hover:underline">
                Sign in
              </Link>
            </p>
          </div>

          <div className="relative">
            <div className="rounded-2xl border border-paper-300 bg-white p-2 shadow-[0_2px_6px_rgba(38,50,56,0.06),0_32px_60px_-32px_rgba(38,50,56,0.35)]">
              <div className="rounded-xl bg-ink-950 p-6">
                <Image
                  src="/brand/lockup-dark.png"
                  alt=""
                  width={1000}
                  height={256}
                  className="h-8 w-auto"
                />
                <p className="mt-6 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-500">
                  Live module
                </p>
                <p className="font-display mt-2 text-[1.375rem] font-semibold text-white">Red Leaf Accounting</p>
                <div className="mt-6 grid gap-2.5">
                  {["Double-entry general ledger", "GST/HST, PST, RST and QST engine", "Bank feeds and reconciliation", "Multi-company and firm access"].map(
                    (line) => (
                      <div key={line} className="flex items-center gap-2.5">
                        <Icon name="check" className="h-4 w-4 shrink-0 text-brand-400" />
                        <span className="text-[0.8125rem] text-ink-300">{line}</span>
                      </div>
                    ),
                  )}
                </div>
                <div className="mt-6 grid grid-cols-3 gap-2 border-t border-ink-800 pt-5">
                  {MODULE_CATALOG.slice(1, 7).map((module) => (
                    <span
                      key={module.id}
                      className="rounded-md bg-ink-900 px-2 py-1.5 text-center text-[0.6875rem] font-medium text-ink-400"
                    >
                      {module.name.replace("Red Leaf ", "")}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-[0.6875rem] text-ink-500">Six further modules on the roadmap.</p>
              </div>
            </div>
          </div>
        </Container>
      </div>

      {/* ── Why Red Leaf ─────────────────────────────────────────────────── */}
      <Section tone="canvas">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat value="Canada" label="Built for Canadian tax, provinces and the CRA calendar — not localised after the fact." />
          <Stat value="1 login" label="One account reaching every company you are entitled to, with a different role in each." />
          <Stat value="7 modules" label="Accounting today; payroll, HR, tax, payments, banking and inventory to follow." />
          <Stat value="0 drift" label="Every report ties back to a journal entry. Reconciliation must reach zero to close." />
        </div>
      </Section>

      {/* ── Accounting ───────────────────────────────────────────────────── */}
      <Section tone="white">
        <SectionHeading
          eyebrow="Available now"
          title="Red Leaf Accounting"
          description="A complete accounting system for service businesses, incorporated companies and the accountants who look after them."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ACCOUNTING_FEATURES.map((feature) => (
            <FeatureCard key={feature.title} icon={feature.icon} title={feature.title}>
              {feature.body}
            </FeatureCard>
          ))}
        </div>
        <div className="mt-8">
          <Cta href="/products/accounting" variant="secondary">
            Everything in Red Leaf Accounting
            <Icon name="chevron" className="h-4 w-4" />
          </Cta>
        </div>
      </Section>

      {/* ── Two customer types ───────────────────────────────────────────── */}
      <Section tone="canvas">
        <SectionHeading
          eyebrow="Built for two kinds of customer"
          title="A business, or a practice with thirty of them"
          description="Red Leaf does not assume one login equals one company. Access is a relationship between a person, a company and a role — so the same account can carry your own books and your clients'."
        />

        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="rounded-(--radius-card) border border-paper-300 bg-white p-7">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand-700">
              <Icon name="building" className="h-5 w-5" />
            </span>
            <h3 className="font-display mt-5 text-[1.25rem] font-semibold text-ink-950">Businesses</h3>
            <p className="mt-3 text-[0.9375rem] leading-7 text-muted-ink">
              The company subscribes. Whoever creates the account becomes Primary Admin, and can invite a
              Secondary Admin plus the rest of the team.
            </p>
            <div className="mt-6">
              <CheckList
                items={[
                  "One company opens straight into its dashboard",
                  "Several companies present a company picker first",
                  "Primary Admin keeps settings, billing and user management",
                  "Secondary Admin gets configurable permissions",
                ]}
              />
            </div>
          </div>

          <div className="rounded-(--radius-card) border border-paper-300 bg-white p-7">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-maple-50 text-maple-600">
              <Icon name="briefcase" className="h-5 w-5" />
            </span>
            <h3 className="font-display mt-5 text-[1.25rem] font-semibold text-ink-950">
              Accountants &amp; bookkeepers
            </h3>
            <p className="mt-3 text-[0.9375rem] leading-7 text-muted-ink">
              One Red Leaf account, every client file. The firm dashboard leads with what needs attention, not
              with a list of logins to remember.
            </p>
            <div className="mt-6">
              <CheckList
                items={[
                  "Client list with status and last activity",
                  "Add a client, or request access to an existing company",
                  "Switch between client files without signing out",
                  "Keep your own company alongside your clients'",
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* ── How subscribing works ────────────────────────────────────────── */}
      <Section tone="white">
        <SectionHeading
          eyebrow="Getting started"
          title="From plan to posted journal entry"
          description="Pick a plan, subscribe, and your Red Leaf environment is created with a Canadian chart of accounts, provincial tax codes and open fiscal periods already in place."
          align="center"
        />
        <ol className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { step: "01", title: "Choose a plan", body: "Monthly, quarterly or annual — the price updates as you switch." },
            { step: "02", title: "Subscribe", body: "Tell us about the business and confirm the subscription." },
            { step: "03", title: "Account created", body: "Chart of accounts, tax codes and fiscal periods provisioned for your province." },
            { step: "04", title: "Start posting", body: "You land in Red Leaf Accounting as Primary Admin, ready to invoice." },
          ].map((item) => (
            <li key={item.step} className="rounded-(--radius-card) border border-paper-300 bg-paper-100 p-5">
              <p className="tnum font-display text-[0.875rem] font-semibold text-brand-700">{item.step}</p>
              <h3 className="mt-3 text-[0.9375rem] font-semibold text-ink-900">{item.title}</h3>
              <p className="mt-2 text-[0.8125rem] leading-6 text-muted-ink">{item.body}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── Module roadmap ───────────────────────────────────────────────── */}
      <Section tone="canvas">
        <SectionHeading
          eyebrow="The platform"
          title="One user and permission model, many products"
          description="The architecture is modular on purpose. Adding payroll or inventory later does not mean rebuilding your users, companies, roles or billing."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULE_CATALOG.map((module) => (
            <FeatureCard
              key={module.id}
              icon={module.icon}
              title={module.name.replace("Red Leaf ", "")}
              badge={module.available ? "Available" : "Coming soon"}
              muted={!module.available}
            >
              {module.blurb}
            </FeatureCard>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Start with accounting. Grow into the platform."
        description="Choose a plan and be posting today, or talk to us about migrating an existing set of books."
        primary={{ href: "/pricing", label: "See pricing" }}
        secondary={{ href: "/contact", label: "Contact us" }}
      />
    </>
  );
}
