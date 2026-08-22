import Link from "next/link";
import { Icon } from "@/components/shell/icons";
import { CtaBand, PageHero, Section, SectionHeading } from "@/components/marketing/ui";

export const metadata = {
  title: "Resources",
  description:
    "Guides, explainers and reference material for running Canadian books in Red Leaf — sales tax, period close, bank reconciliation and working with your accountant.",
};

/**
 * The client has not supplied article content yet, so each card states plainly
 * that it is in preparation rather than linking to a page that does not exist.
 * Replace `status` with an `href` as real articles arrive.
 */
const GUIDES: { icon: string; title: string; blurb: string; kind: string }[] = [
  {
    icon: "percent",
    title: "Canadian sales tax, plainly explained",
    blurb: "GST, HST, PST, RST and QST — who registers, what rate applies where, and why compound tax in Quebec needs exact arithmetic.",
    kind: "Guide",
  },
  {
    icon: "bank",
    title: "Reconciling a bank account properly",
    blurb: "Why a reconciliation that does not reach zero is not a reconciliation, and how rules and matching get you there faster.",
    kind: "Guide",
  },
  {
    icon: "lock",
    title: "Closing a period without regret",
    blurb: "What to check before you lock a month, how to handle a late invoice, and why reversal beats editing.",
    kind: "Guide",
  },
  {
    icon: "ledger",
    title: "Reading your own financial statements",
    blurb: "Balance sheet, profit and loss and cash flow — what each one answers, and how to trace a figure back to a journal entry.",
    kind: "Explainer",
  },
  {
    icon: "users",
    title: "Working with your accountant in Red Leaf",
    blurb: "How to give a practice access to your books, what they can see, and what stays under your control.",
    kind: "How-to",
  },
  {
    icon: "briefcase",
    title: "Moving a client portfolio across",
    blurb: "A practical migration order for a practice bringing several client files onto one Red Leaf account.",
    kind: "How-to",
  },
];

const FAQ = [
  {
    q: "Is Red Leaf tax advice?",
    a: "No. Red Leaf Accounting is software. Canadian rates and filing obligations vary by province, registration and transaction type, so a qualified CPA should review your chart of accounts and tax setup before you file.",
  },
  {
    q: "Can I export my data?",
    a: "Yes, always — including if a trial lapses or a subscription is cancelled. Your books stay readable and exportable.",
  },
  {
    q: "Do you support multiple currencies?",
    a: "Books are kept in CAD today. Multi-currency is on the roadmap alongside the payments module.",
  },
  {
    q: "How do I get help?",
    a: "Every plan includes support; Business and Firm plans get priority handling. Use the contact form and tell us the company and the screen you are on.",
  },
];

export default function ResourcesPage() {
  return (
    <>
      <PageHero
        eyebrow="Resources"
        title="Material to help you keep good books"
        description="Practical guides written for Canadian businesses and the people who do their bookkeeping. The first set is in preparation — tell us what you need and we will prioritise it."
      />

      <Section tone="canvas">
        <SectionHeading
          eyebrow="Guides and explainers"
          title="In preparation"
          description="Each of these is being written now. Ask for one and we will send it as soon as it is ready."
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDES.map((guide) => (
            <article key={guide.title} className="flex flex-col rounded-(--radius-card) border border-paper-300 bg-white p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand-700">
                  <Icon name={guide.icon} className="h-[1.15rem] w-[1.15rem]" />
                </span>
                <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-ink-600">
                  {guide.kind}
                </span>
              </div>
              <h3 className="mt-4 text-[0.9375rem] font-semibold leading-6 text-ink-900">{guide.title}</h3>
              <p className="mt-2 flex-1 text-[0.875rem] leading-6 text-muted-ink">{guide.blurb}</p>
              <Link
                href={`/contact?topic=resource&subject=${encodeURIComponent(guide.title)}`}
                className="mt-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-700 hover:underline"
              >
                Request this guide
                <Icon name="chevron" className="h-3.5 w-3.5" />
              </Link>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="white">
        <SectionHeading eyebrow="Common questions" title="Quick answers" align="center" />
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
        title="Something you wish existed?"
        description="Tell us the question you could not find an answer to and we will write it up."
        primary={{ href: "/contact?topic=resource", label: "Suggest a topic" }}
        secondary={{ href: "/products/accounting", label: "See the product" }}
      />
    </>
  );
}
