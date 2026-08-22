"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Icon } from "@/components/shell/icons";
import { Field, inputClass } from "@/components/ui";
import { submitContactAction, type ContactResult } from "./actions";

const TOPICS = [
  { value: "sales", label: "Choosing a plan" },
  { value: "demo", label: "Request a walkthrough" },
  { value: "migration", label: "Moving existing books" },
  { value: "firm", label: "Accounting practice enquiry" },
  { value: "password", label: "Account or sign-in help" },
  { value: "resource", label: "Guides and resources" },
  { value: "roadmap", label: "Roadmap and modules" },
  { value: "other", label: "Something else" },
];

export function ContactForm({ initialTopic, initialSubject }: { initialTopic?: string; initialSubject?: string }) {
  const [result, setResult] = useState<ContactResult | null>(null);
  const topic = TOPICS.some((t) => t.value === initialTopic) ? initialTopic : "sales";

  async function onSubmit(formData: FormData) {
    setResult(await submitContactAction(formData));
  }

  if (result && "ok" in result) {
    return (
      <div className="rounded-(--radius-card) border border-[color:var(--color-positive)]/30 bg-positive-soft p-6">
        <div className="flex items-center gap-2.5">
          <Icon name="check" className="h-5 w-5 text-positive" />
          <h3 className="text-[0.9375rem] font-semibold text-ink-900">Thank you — that is with us</h3>
        </div>
        <p className="mt-2 text-[0.875rem] leading-6 text-ink-700">
          We read every enquiry ourselves and will come back to you shortly.
        </p>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" required>
          <input name="name" required autoComplete="name" className={inputClass} placeholder="Jane Smith" />
        </Field>
        <Field label="Work email" required>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputClass}
            placeholder="jane@company.ca"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company">
          <input name="company" autoComplete="organization" className={inputClass} placeholder="ABC Manufacturing Inc." />
        </Field>
        <Field label="Phone">
          <input name="phone" type="tel" autoComplete="tel" className={inputClass} placeholder="(555) 010-2030" />
        </Field>
      </div>

      <Field label="What is this about?">
        <select name="topic" defaultValue={topic} className={inputClass}>
          {TOPICS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="How can we help?" required hint="The more you tell us, the more useful our first reply will be.">
        <textarea
          name="message"
          required
          rows={6}
          defaultValue={initialSubject ? `I would like: ${initialSubject}\n\n` : ""}
          className={inputClass}
          placeholder="We run two corporations in Ontario and want to move off spreadsheets before year end…"
        />
      </Field>

      {result && "error" in result && (
        <div className="rounded-md border border-[color:var(--color-caution)]/30 bg-caution-soft px-3.5 py-3 text-[0.8125rem] leading-6 text-ink-800">
          {result.error}
          {result.fallbackEmail && (
            <>
              {" "}
              <a href={`mailto:${result.fallbackEmail}`} className="font-medium text-brand-700 hover:underline">
                {result.fallbackEmail}
              </a>
            </>
          )}
        </div>
      )}

      <SubmitButton />

      <p className="text-[0.75rem] leading-5 text-muted-ink">
        We use what you send here only to answer your enquiry.
      </p>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-[0.9375rem] font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Sending…" : "Send enquiry"}
    </button>
  );
}
