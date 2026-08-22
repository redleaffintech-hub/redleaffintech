import { Icon } from "@/components/shell/icons";
import {
  CheckList,
  CtaBand,
  FeatureCard,
  PageHero,
  Section,
  SectionHeading,
} from "@/components/marketing/ui";

export const metadata = {
  title: "About Us",
  description:
    "Red Leaf Fintech Inc. builds business management software for Canadian companies — starting with a rigorous accounting system and growing into payroll, HR, tax, payments, banking and inventory.",
};

const PRINCIPLES = [
  {
    icon: "ledger",
    title: "The ledger is the truth",
    body: "Nothing is a summary table waiting to drift. Every invoice, bill, expense and bank line posts a balanced journal entry, and every figure on every report traces back to it.",
  },
  {
    icon: "percent",
    title: "Canadian by construction",
    body: "GST, HST, PST, RST and QST are an effective-dated engine, not hard-coded rates. Provinces, fiscal calendars and the CRA's rounding are first-class, not a localisation layer.",
  },
  {
    icon: "shield",
    title: "Authorisation is server-side",
    body: "The interface hides what you cannot do, but hiding is never the control. Every request re-checks the company and the permission behind it.",
  },
  {
    icon: "box",
    title: "Modular from the start",
    body: "Users, companies, roles and billing sit below the products. Adding payroll or inventory later does not mean rebuilding the foundation.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About Us"
        title="Software for the businesses that keep Canada running"
        description="Red Leaf Fintech Inc. is building one platform for the back office of a Canadian company. We started with accounting because it is the hardest part to get right — and because everything else depends on it being right."
      />

      <Section tone="canvas">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div className="max-w-2xl">
            <SectionHeading
              eyebrow="Why we exist"
              title="Most small businesses are running on trust, not on books"
            />
            <div className="mt-6 grid gap-5 text-[1rem] leading-8 text-muted-ink">
              <p>
                Ask a Canadian owner-operator where their numbers live and the honest answer is usually
                somewhere between a shoebox, a spreadsheet and their bookkeeper&rsquo;s memory. The tools that promise
                to fix it either come from somewhere else — with tax rules bolted on afterwards — or they treat
                the general ledger as an implementation detail.
              </p>
              <p>
                We took the opposite approach. Red Leaf Accounting is a real double-entry system first: the tax
                engine is effective-dated, a reconciliation will not close while a difference remains, and a
                posted journal entry is never quietly edited. Then we made it something an accounting practice
                can actually live in, because in this country the accountant is usually the one holding the
                books together.
              </p>
              <p>
                Accounting is the first product, not the whole plan. Payroll, HR, tax, payments, banking and
                inventory are all coming to the same platform — sharing one set of users, companies, roles and
                subscriptions, so growing into them costs you nothing but a switch.
              </p>
            </div>
          </div>

          <div className="rounded-(--radius-card) border border-paper-300 bg-white p-7">
            <h3 className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-500">
              At a glance
            </h3>
            <dl className="mt-5 grid gap-4">
              {[
                { label: "Company", value: "Red Leaf Fintech Inc." },
                { label: "Focus", value: "Business management software for Canadian companies" },
                { label: "Live product", value: "Red Leaf Accounting" },
                { label: "Serving", value: "Small businesses, multi-entity owners and accounting practices" },
                { label: "Currency & locale", value: "CAD, en-CA, province-aware" },
              ].map((row) => (
                <div key={row.label}>
                  <dt className="text-[0.75rem] font-medium uppercase tracking-[0.08em] text-muted-ink">
                    {row.label}
                  </dt>
                  <dd className="mt-1 text-[0.9375rem] font-medium text-ink-900">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>

      <Section tone="white">
        <SectionHeading
          eyebrow="How we build"
          title="Four commitments that shape every screen"
          description="These are not values on a wall — each one is a constraint that shows up in the code."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map((item) => (
            <FeatureCard key={item.title} icon={item.icon} title={item.title}>
              {item.body}
            </FeatureCard>
          ))}
        </div>
      </Section>

      <Section tone="canvas">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading eyebrow="Where we are going" title="A back office that grows with the business" />
            <p className="mt-5 text-[1rem] leading-8 text-muted-ink">
              A company that starts with us on invoicing should be able to add payroll without changing systems,
              then HR, then inventory — with the same login, the same permissions and one subscription. That is
              the whole point of building the platform underneath before the products on top.
            </p>
          </div>
          <div className="rounded-(--radius-card) border border-paper-300 bg-white p-7">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-maple-50 text-maple-600">
                <Icon name="leaf" className="h-5 w-5" />
              </span>
              <h3 className="text-[0.9375rem] font-semibold text-ink-900">On the roadmap</h3>
            </div>
            <div className="mt-5">
              <CheckList
                items={[
                  "Red Leaf Payroll — pay runs, source deductions, T4s and ROEs",
                  "Red Leaf HR — employee records, time off and onboarding",
                  "Red Leaf Tax — corporate and sales tax preparation",
                  "Red Leaf Payments — card and bank payment on invoices",
                  "Red Leaf Banking — direct connections and payment initiation",
                  "Red Leaf Inventory — stock, costing and cost of goods sold",
                ]}
              />
            </div>
          </div>
        </div>
      </Section>

      <CtaBand
        title="Want to talk before you commit?"
        description="Tell us about the business — how many entities, who needs access, and what you are moving from."
        primary={{ href: "/contact", label: "Contact us" }}
        secondary={{ href: "/pricing", label: "See pricing" }}
      />
    </>
  );
}
