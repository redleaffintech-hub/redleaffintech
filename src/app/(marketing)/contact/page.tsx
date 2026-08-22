import { Icon } from "@/components/shell/icons";
import { Container, Eyebrow, Section } from "@/components/marketing/ui";
import { ContactForm } from "./contact-form";

export const metadata = {
  title: "Contact Us",
  description:
    "Talk to Red Leaf Fintech about plans, migrating an existing set of books, or an accounting practice enquiry.",
};

const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? "hello@redleaffintech.com";

export default async function ContactPage({ searchParams }: PageProps<"/contact">) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  return (
    <>
      <div className="border-b border-paper-300 bg-white">
        <Container className="py-14 sm:py-20">
          <Eyebrow>Contact Us</Eyebrow>
          <h1 className="font-display mt-3 max-w-3xl text-[2.125rem] font-semibold leading-[1.12] tracking-[-0.03em] text-ink-950 sm:text-[2.75rem]">
            Let&rsquo;s talk about your books
          </h1>
          <p className="mt-5 max-w-2xl text-[1.0625rem] leading-8 text-muted-ink">
            Whether you are choosing between plans, moving several entities across, or running a practice with a
            portfolio of clients — tell us what you are working with and we will tell you how Red Leaf fits.
          </p>
        </Container>
      </div>

      <Section tone="canvas">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <div className="rounded-(--radius-card) border border-paper-300 bg-white p-7 sm:p-9">
            <h2 className="font-display text-[1.25rem] font-semibold tracking-[-0.02em] text-ink-950">
              Send us a message
            </h2>
            <p className="mt-2 text-[0.875rem] leading-6 text-muted-ink">
              Fields marked with an asterisk are required.
            </p>
            <div className="mt-7">
              <ContactForm initialTopic={first(params.topic)} initialSubject={first(params.subject)} />
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-(--radius-card) border border-paper-300 bg-white p-7">
              <h3 className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-ink-500">
                Reach us directly
              </h3>
              <ul className="mt-5 grid gap-4">
                <li className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-700">
                    <Icon name="mail" className="h-[1.15rem] w-[1.15rem]" />
                  </span>
                  <span>
                    <span className="block text-[0.75rem] font-medium uppercase tracking-[0.08em] text-muted-ink">
                      Email
                    </span>
                    <a
                      href={`mailto:${CONTACT_EMAIL}`}
                      className="text-[0.9375rem] font-medium text-brand-700 hover:underline"
                    >
                      {CONTACT_EMAIL}
                    </a>
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-700">
                    <Icon name="clock" className="h-[1.15rem] w-[1.15rem]" />
                  </span>
                  <span>
                    <span className="block text-[0.75rem] font-medium uppercase tracking-[0.08em] text-muted-ink">
                      Hours
                    </span>
                    <span className="text-[0.9375rem] font-medium text-ink-900">
                      Monday to Friday, 9am–6pm ET
                    </span>
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-700">
                    <Icon name="building" className="h-[1.15rem] w-[1.15rem]" />
                  </span>
                  <span>
                    <span className="block text-[0.75rem] font-medium uppercase tracking-[0.08em] text-muted-ink">
                      Company
                    </span>
                    <span className="text-[0.9375rem] font-medium text-ink-900">Red Leaf Fintech Inc.</span>
                    <span className="mt-0.5 block text-[0.8125rem] text-muted-ink">Canada</span>
                  </span>
                </li>
              </ul>
            </div>

            <div className="rounded-(--radius-card) border border-paper-300 bg-brand-soft p-7">
              <h3 className="text-[0.9375rem] font-semibold text-ink-900">Already a customer?</h3>
              <p className="mt-2 text-[0.875rem] leading-6 text-ink-700">
                Sign in and use the help link inside your company file — we will already know which books you
                are asking about.
              </p>
              <a
                href="/login"
                className="mt-4 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-brand-700 hover:underline"
              >
                Go to sign in
                <Icon name="chevron" className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
