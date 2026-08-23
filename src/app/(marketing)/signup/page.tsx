import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { formatMoney } from "@/lib/money";
import {
  CYCLE_LABELS,
  CYCLE_MONTHS,
  cyclePriceCents,
  monthlyEquivalentCents,
  planByCode,
  isValidCycle,
  type BillingCycle,
} from "@/lib/plans";
import { Container, Cta, Eyebrow, Section } from "@/components/marketing/ui";
import { publicPlans } from "@/server/plans/catalogue";

export const metadata = {
  title: "Subscribe",
  description: "Reserve your Red Leaf Fintech account and we will set up your company file.",
};

/**
 * Phase 1 lands here from every pricing CTA so no link is dead. Phase 2 replaces
 * this with the real flow: account details -> checkout -> provisioning -> app.
 */
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const plan = planByCode(await publicPlans(), first(params.plan));
  const rawCycle = (first(params.cycle) ?? "").toUpperCase();
  const cycle: BillingCycle = isValidCycle(rawCycle) ? rawCycle : "MONTHLY";

  return (
    <>
      <div className="border-b border-paper-300 bg-white">
        <Container className="py-14 sm:py-20">
          <Eyebrow>Subscribe</Eyebrow>
          <h1 className="font-display mt-3 max-w-3xl text-[2.125rem] font-semibold leading-[1.12] tracking-[-0.03em] text-ink-950 sm:text-[2.75rem]">
            {plan ? `Reserve the ${plan.name} plan` : "Reserve your Red Leaf account"}
          </h1>
          <p className="mt-5 max-w-2xl text-[1.0625rem] leading-8 text-muted-ink">
            Self-serve checkout is being connected. In the meantime, send us the details below and we will create
            your company file — provisioned with a Canadian chart of accounts, your provincial tax codes and open
            fiscal periods — then hand you the keys as Primary Admin.
          </p>
        </Container>
      </div>

      <Section tone="canvas">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          {/* Chosen plan */}
          <div className="rounded-(--radius-card) border border-brand-200 bg-white p-7">
            <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-500">
              Your selection
            </h2>

            {plan ? (
              <>
                <p className="font-display mt-4 text-[1.5rem] font-semibold tracking-[-0.02em] text-ink-950">
                  {plan.name}
                </p>
                <p className="mt-1.5 text-[0.875rem] leading-6 text-muted-ink">{plan.forWhom}</p>

                <dl className="mt-6 grid gap-2.5 border-y border-paper-300 py-5 text-[0.875rem]">
                  <Row label="Billing" value={CYCLE_LABELS[cycle]} />
                  <Row
                    label="Price"
                    value={`${formatMoney(monthlyEquivalentCents(plan, cycle), { currency: plan.currency }).replace(/\.00$/, "")} / month`}
                  />
                  <Row
                    label="Charged"
                    value={
                      CYCLE_MONTHS[cycle] === 1
                        ? "monthly"
                        : `${formatMoney(cyclePriceCents(plan, cycle), { currency: plan.currency }).replace(/\.00$/, "")} every ${CYCLE_MONTHS[cycle]} months`
                    }
                  />
                  <Row label="Users included" value={String(plan.seats)} />
                  <Row label="Companies" value={String(plan.companies)} />
                  <Row label="Support" value={plan.support} />
                </dl>

                <p className="mt-5 text-[0.8125rem] text-muted-ink">
                  Wrong plan?{" "}
                  <Link href="/pricing" className="font-medium text-brand-700 hover:underline">
                    Compare them again
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <p className="mt-4 text-[0.9375rem] leading-7 text-muted-ink">
                  No plan selected yet. Have a look at the four plans and pick the one that matches how many
                  people and companies you bring.
                </p>
                <div className="mt-6">
                  <Cta href="/pricing">
                    See pricing
                    <Icon name="chevron" className="h-4 w-4" />
                  </Cta>
                </div>
              </>
            )}
          </div>

          {/* What happens next */}
          <div className="rounded-(--radius-card) border border-paper-300 bg-white p-7 sm:p-9">
            <h2 className="font-display text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">
              What happens next
            </h2>

            <ol className="mt-7 grid gap-6">
              {[
                {
                  title: "You tell us about the business",
                  body: "Legal name, province, fiscal year start and who should be Primary Admin.",
                },
                {
                  title: "We provision the company file",
                  body: "Chart of accounts, GST/HST/PST/QST codes for your province, and fiscal and filing periods opened.",
                },
                {
                  title: "You confirm the subscription",
                  body: `${plan ? plan.name : "Your plan"} on ${CYCLE_LABELS[cycle].toLowerCase()} billing, starting the day you sign in.`,
                },
                {
                  title: "You start posting",
                  body: "Sign in as Primary Admin, invite your team, and raise the first invoice.",
                },
              ].map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="tnum grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[0.8125rem] font-semibold text-brand-700">
                    {index + 1}
                  </span>
                  <span>
                    <span className="block text-[0.9375rem] font-semibold text-ink-900">{step.title}</span>
                    <span className="mt-1 block text-[0.875rem] leading-6 text-muted-ink">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-9 flex flex-wrap gap-3 border-t border-paper-300 pt-7">
              <Cta
                href={`/contact?topic=sales&subject=${encodeURIComponent(
                  plan ? `${plan.name} plan, ${CYCLE_LABELS[cycle].toLowerCase()} billing` : "Subscribing to Red Leaf",
                )}`}
                size="lg"
              >
                Reserve this plan
                <Icon name="chevron" className="h-4 w-4" />
              </Cta>
              <Cta href="/products/accounting" variant="secondary" size="lg">
                See what is included
              </Cta>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-ink">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
