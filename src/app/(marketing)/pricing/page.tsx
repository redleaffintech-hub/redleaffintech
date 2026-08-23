import { PricingTable } from "@/components/marketing/pricing-table";
import { Container, CtaBand, Eyebrow, Section, SectionHeading } from "@/components/marketing/ui";
import { isValidCycle, type BillingCycle } from "@/lib/plans";
import { publicPlans } from "@/server/plans/catalogue";

/**
 * Plans come from the published catalogue, so this page is cached rather than
 * queried per visitor. Publishing a plan calls `revalidatePath("/pricing")`,
 * which is what makes a price change appear immediately instead of after the
 * window elapses.
 */
export const revalidate = 300;

export const metadata = {
  title: "Pricing",
  description:
    "Red Leaf Fintech pricing — Starter, Professional, Business and Firm plans, billed monthly, quarterly or annually. All prices in CAD.",
};

const FAQ = [
  {
    q: "Can I change plans later?",
    a: "Yes. Upgrade or downgrade whenever you like; the seat and company limits move with the plan. A downgrade is blocked only while more people have access than the smaller plan allows.",
  },
  {
    q: "What counts as a company?",
    a: "One legal entity with its own books — its own chart of accounts, tax registrations and financial statements. A plan's company allowance is how many of those one subscription covers.",
  },
  {
    q: "What counts as a user?",
    a: "Any person who signs in. Users are invited to a company and given a role there, so the same person can hold different permissions in different companies without a second account.",
  },
  {
    q: "Do you support accounting firms?",
    a: "Yes — the Firm plan gives a practice one login across every client file, with a client dashboard, a review queue and a close checklist. An accountant can keep their own company alongside their clients'.",
  },
  {
    q: "Which taxes are handled?",
    a: "GST, HST, PST, RST and QST, as an effective-dated engine rather than hard-coded rates. Tax codes are provisioned for your province when the company is created.",
  },
  {
    q: "Is my data mine?",
    a: "Always. Your books stay readable and exportable, including if a trial lapses or a subscription is cancelled.",
  },
];

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const params = await searchParams;
  const raw = Array.isArray(params.cycle) ? params.cycle[0] : params.cycle;
  const initialCycle: BillingCycle = isValidCycle(raw?.toUpperCase()) ? (raw!.toUpperCase() as BillingCycle) : "MONTHLY";
  const plans = await publicPlans();

  return (
    <>
      <div className="border-b border-paper-300 bg-white">
        <Container className="py-14 text-center sm:py-20">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="font-display mx-auto mt-3 max-w-3xl text-[2.125rem] font-semibold leading-[1.12] tracking-[-0.03em] text-ink-950 sm:text-[2.75rem]">
            Straightforward plans, priced per business
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[1.0625rem] leading-8 text-muted-ink">
            Every plan includes the full double-entry ledger and the Canadian tax engine. What changes is how
            many people and companies you bring, and how much support you want.
          </p>
        </Container>
      </div>

      <Section tone="canvas">
        <PricingTable plans={plans} initialCycle={initialCycle} />
      </Section>

      <Section tone="white">
        <SectionHeading eyebrow="Questions" title="Before you subscribe" align="center" />
        <dl className="mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-(--radius-card) border border-paper-300 bg-paper-100 p-5">
              <dt className="text-[0.9375rem] font-semibold text-ink-900">{item.q}</dt>
              <dd className="mt-2 text-[0.875rem] leading-6 text-muted-ink">{item.a}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <CtaBand
        title="Not sure which plan fits?"
        description="Tell us how many entities you run and who needs access, and we will point you at the right one."
        primary={{ href: "/contact", label: "Contact us" }}
        secondary={{ href: "/products/accounting", label: "Explore the product" }}
      />
    </>
  );
}
