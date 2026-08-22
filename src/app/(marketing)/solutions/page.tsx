import { Icon } from "@/components/shell/icons";
import { CheckList, Cta, CtaBand, PageHero, Section, SectionHeading } from "@/components/marketing/ui";

export const metadata = {
  title: "Solutions",
  description:
    "How Red Leaf fits a sole proprietor, a growing incorporated business, an owner with several corporations, and an accounting practice carrying a portfolio of client files.",
};

const SOLUTIONS = [
  {
    icon: "building",
    eyebrow: "Small business",
    title: "One company, one owner, no surprises",
    body: "You subscribe, you become Primary Admin, and you land straight in your own dashboard. Invoicing, expenses, bank import and a GST/HST working paper are there from the first day, with the ledger keeping itself honest behind you.",
    points: [
      "Provisioned with a Canadian chart of accounts",
      "Sales tax handled for your province automatically",
      "Bank rules learn how you categorise",
      "Statements your accountant will recognise",
    ],
    plan: "Starter or Professional",
  },
  {
    icon: "briefcase",
    eyebrow: "Growing business",
    title: "A team, with different levels of trust",
    body: "Add a bookkeeper who can raise invoices but not close a period, a reviewer who can approve but not originate, and a manager who only ever reads. Permissions are checked on the server for every request, not hidden in the interface.",
    points: [
      "Primary and Secondary Admin roles",
      "Bill approvals before anything is paid",
      "Period close and locked history",
      "A complete audit trail of who changed what",
    ],
    plan: "Professional",
  },
  {
    icon: "chart",
    eyebrow: "Multi-entity owner",
    title: "Several corporations, one login",
    body: "An operating company, a holding company and a real-estate company do not need three logins and three passwords. Sign in once, pick the entity, and each set of books stays completely separate underneath.",
    points: [
      "A company picker after sign-in",
      "Switch entities without signing out",
      "Separate ledgers, numbering and tax registrations",
      "One subscription covering the group",
    ],
    plan: "Business",
  },
  {
    icon: "users",
    eyebrow: "Accounting practice",
    title: "A portfolio, not a pile of client logins",
    body: "The firm workspace opens on what needs attention: which files are out of balance, whose bank queue is backing up, which return is due next. Then you step into a client file and work in their books, with your own company sitting alongside.",
    points: [
      "Client dashboard with status and last activity",
      "Review queue and close checklist",
      "Add a client, or request access to an existing company",
      "Keep your own company on the same account",
    ],
    plan: "Firm",
  },
];

export default function SolutionsPage() {
  return (
    <>
      <PageHero
        eyebrow="Solutions"
        title="The same platform, shaped to how you actually work"
        description="Red Leaf does not assume one login equals one company. Access is a relationship between a person, a company and a role — which is what makes all four of these work on one account."
      />

      <Section tone="canvas">
        <div className="grid gap-5">
          {SOLUTIONS.map((solution, index) => (
            <article
              key={solution.title}
              className="grid gap-8 rounded-(--radius-card) border border-paper-300 bg-white p-7 sm:p-9 lg:grid-cols-[1.15fr_0.85fr]"
            >
              <div>
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-soft text-brand-700">
                    <Icon name={solution.icon} className="h-5 w-5" />
                  </span>
                  <p className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-brand-700">
                    {solution.eyebrow}
                  </p>
                </div>
                <h2 className="font-display mt-5 text-[1.375rem] font-semibold leading-[1.25] tracking-[-0.02em] text-ink-950">
                  {solution.title}
                </h2>
                <p className="mt-4 max-w-xl text-[0.9375rem] leading-7 text-muted-ink">{solution.body}</p>
                <p className="mt-5 text-[0.8125rem] text-muted-ink">
                  Typically on{" "}
                  <span className="font-medium text-ink-900">{solution.plan}</span>
                </p>
              </div>

              <div className="rounded-lg bg-paper-100 p-6">
                <p className="text-[0.75rem] font-semibold uppercase tracking-[0.1em] text-ink-500">
                  What you get
                </p>
                <div className="mt-4">
                  <CheckList items={solution.points} />
                </div>
              </div>

              <span className="sr-only">Solution {index + 1}</span>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="white">
        <SectionHeading
          eyebrow="Worth knowing"
          title="An accountant can be a customer too"
          description="Nothing in Red Leaf assumes an accountant has no business of their own. A practice can carry thirty client files and its own set of books on the same login, switching between them like any other company."
          align="center"
        />
        <div className="mt-8 flex justify-center">
          <Cta href="/pricing?cycle=ANNUAL" variant="secondary">
            Compare the Firm plan
            <Icon name="chevron" className="h-4 w-4" />
          </Cta>
        </div>
      </Section>

      <CtaBand
        title="Tell us how your books are arranged"
        description="Entities, team, who reviews what, and what you are migrating from — we will tell you how it maps."
        primary={{ href: "/contact", label: "Contact us" }}
        secondary={{ href: "/pricing", label: "See pricing" }}
      />
    </>
  );
}
